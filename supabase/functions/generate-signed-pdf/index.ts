import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

function assertSignaturePayload(
  signatureData: string,
  signatureType: string,
  organizationId: string,
  staffId: string,
): string | null {
  if (signatureType === "draw") {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(organizationId) || !uuid.test(staffId)) return "Invalid signature path";
    // StaffSignatureManager stores drawn signatures at this exact prefix.
    // Anything else (../, another org, another bucket path) is rejected
    // before the storage download.
    const pathOk = new RegExp(
      `^signatures/${organizationId}/${staffId}/[0-9a-f-]{36}_\\d+\\.png$`,
      "i",
    ).test(signatureData);
    if (!pathOk || signatureData.includes("..") || signatureData.includes("\\") || signatureData.includes("\0")) {
      return "Invalid signature path";
    }
    return null;
  }
  if (signatureData.length > 200 || signatureData.includes("\0")) {
    return "Invalid signature";
  }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      document_id, staff_id, organization_id,
      signature_data, signature_type, staff_name,
      placement, // { page, xPercent, yPercent, pageWidth, pageHeight }
    } = body;

    if (!document_id || !staff_id || !organization_id || !signature_data || !signature_type) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signatureError = assertSignaturePayload(
      String(signature_data),
      String(signature_type),
      String(organization_id),
      String(staff_id),
    );
    if (signatureError) {
      return new Response(JSON.stringify({ error: signatureError }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify staff belongs to org
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id, name, organization_id, user_id")
      .eq("id", staff_id)
      .eq("organization_id", organization_id)
      .single();

    if (staffError || !staff) {
      return new Response(JSON.stringify({ error: "Staff not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: caller must be the staff member themselves OR an org owner/admin.
    // Without this, any authenticated user could forge signatures for any staff.
    const isOwnSignature = staff.user_id && staff.user_id === user.id;
    if (!isOwnSignature) {
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .maybeSingle();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get document
    const { data: doc, error: docError } = await supabase
      .from("staff_signable_documents")
      .select("*")
      .eq("id", document_id)
      .eq("organization_id", organization_id)
      .single();

    if (docError || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download original PDF
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("staff-documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: "Failed to download document" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pdfBytes = await fileData.arrayBuffer();
    let pdfDoc: PDFDocument;

    try {
      pdfDoc = await PDFDocument.load(pdfBytes);
    } catch {
      pdfDoc = await PDFDocument.create();
    }

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const signedDate = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const signerName = staff_name || staff.name || "N/A";

    // If placement coordinates provided, place signature directly on the document page
    if (placement && typeof placement.page === "number") {
      const pageIndex = placement.page;
      const pages = pdfDoc.getPages();

      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const { width: pW, height: pH } = page.getSize();

        // Convert percentage coordinates to PDF points
        // PDF y-axis is bottom-up, browser y-axis is top-down
        const sigX = placement.xPercent * pW;
        const sigY = (1 - placement.yPercent) * pH;

        if (signature_type === "draw") {
          // Download signature image from storage
          const { data: sigData } = await supabase.storage
            .from("staff-documents")
            .download(signature_data);

          if (sigData) {
            try {
              const sigBytes = await sigData.arrayBuffer();
              const sigImage = await pdfDoc.embedPng(new Uint8Array(sigBytes));
              const sigDims = sigImage.scale(0.5);
              const maxW = 180;
              const maxH = 60;
              const sc = Math.min(maxW / sigDims.width, maxH / sigDims.height, 1);
              const finalW = sigDims.width * sc;
              const finalH = sigDims.height * sc;

              page.drawImage(sigImage, {
                x: sigX - finalW * 0.1,
                y: sigY - finalH * 0.8,
                width: finalW,
                height: finalH,
              });
            } catch {
              // Fallback to text
              page.drawText("[Signature]", {
                x: sigX, y: sigY - 15,
                size: 12, font: helvetica, color: rgb(0, 0, 0),
              });
            }
          }
        } else {
          // Typed signature
          const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
          page.drawText(signature_data, {
            x: sigX,
            y: sigY - 20,
            size: 18,
            font: timesRoman,
            color: rgb(0, 0, 0),
          });
        }

        // Add a small date/name annotation below the signature
        page.drawText(`${signerName} — ${signedDate}`, {
          x: sigX,
          y: sigY - (signature_type === "draw" ? 70 : 38),
          size: 7,
          font: helvetica,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
    }

    // Always add a verification page at the end for legal record
    await addVerificationPage(pdfDoc, {
      helvetica, helveticaBold, doc, signerName, signedDate,
      signature_data, signature_type, placement,
      supabase,
    });

    const signedPdfBytes = await pdfDoc.save();
    const signedPath = `signed/${organization_id}/${staff_id}/${document_id}_${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("staff-documents")
      .upload(signedPath, signedPdfBytes, { contentType: "application/pdf" });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Failed to save signed PDF" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persist the path server-side; clients no longer have UPDATE on this table.
    const { data: updatedRows, error: pathUpdateError } = await supabase
      .from("staff_signatures")
      .update({ signed_pdf_path: signedPath })
      .eq("signable_document_id", document_id)
      .eq("staff_id", staff_id)
      .eq("organization_id", organization_id)
      .select("id");

    if (pathUpdateError) {
      console.error("Failed to persist signed_pdf_path:", pathUpdateError);
    } else if (!updatedRows || updatedRows.length === 0) {
      console.warn(
        `signed_pdf_path not persisted: no staff_signatures row for document ${document_id}, staff ${staff_id}, org ${organization_id}`
      );
    }

    return new Response(
      JSON.stringify({ success: true, signed_pdf_path: signedPath }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating signed PDF:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Adds a lightweight verification/audit page at the end
async function addVerificationPage(
  pdfDoc: PDFDocument,
  opts: {
    helvetica: any; helveticaBold: any;
    doc: any; signerName: string; signedDate: string;
    signature_data: string; signature_type: string;
    placement: any; supabase: any;
  }
) {
  const { helvetica, helveticaBold, doc, signerName, signedDate, signature_data, signature_type, placement, supabase } = opts;
  const page = pdfDoc.addPage([612, 792]);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lineColor = rgb(0.7, 0.7, 0.7);

  page.drawText("SIGNATURE VERIFICATION", {
    x: 72, y: 720, size: 16, font: helveticaBold, color: black,
  });

  page.drawText(`Document: ${doc.title}`, {
    x: 72, y: 690, size: 11, font: helvetica, color: gray,
  });

  page.drawLine({ start: { x: 72, y: 678 }, end: { x: 540, y: 678 }, thickness: 1, color: lineColor });

  const lines = [
    `Signer: ${signerName}`,
    `Date: ${signedDate}`,
    `Method: ${signature_type === 'draw' ? 'Drawn signature' : 'Typed signature'}`,
    placement ? `Placed on page ${placement.page + 1} at position (${Math.round(placement.xPercent * 100)}%, ${Math.round(placement.yPercent * 100)}%)` : 'Placed on verification page',
  ];

  let y = 650;
  for (const line of lines) {
    page.drawText(line, { x: 72, y, size: 11, font: helvetica, color: black });
    y -= 22;
  }

  page.drawText("Signature:", { x: 72, y: 530, size: 10, font: helveticaBold, color: gray });

  if (signature_type === "draw") {
    try {
      const { data: sigData } = await supabase.storage
        .from("staff-documents")
        .download(signature_data);

      if (sigData) {
        const sigBytes = await sigData.arrayBuffer();
        const sigImage = await pdfDoc.embedPng(new Uint8Array(sigBytes));
        const sigDims = sigImage.scale(0.5);
        const maxW = 250;
        const maxH = 80;
        const scale = Math.min(maxW / sigDims.width, maxH / sigDims.height, 1);

        page.drawImage(sigImage, {
          x: 72,
          y: 430,
          width: sigDims.width * scale,
          height: sigDims.height * scale,
        });
      } else {
        page.drawText("[Drawn signature on file]", {
          x: 72, y: 470, size: 12, font: helvetica, color: gray,
        });
      }
    } catch {
      page.drawText("[Drawn signature on file]", {
        x: 72, y: 470, size: 12, font: helvetica, color: gray,
      });
    }
  } else {
    const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    page.drawText(signature_data, {
      x: 72,
      y: 470,
      size: 24,
      font: timesRoman,
      color: black,
    });
  }

  page.drawLine({ start: { x: 72, y: 420 }, end: { x: 350, y: 420 }, thickness: 0.5, color: lineColor });

  page.drawText(
    "This document was electronically signed and is legally binding.",
    { x: 72, y: 60, size: 8, font: helvetica, color: gray }
  );
}
