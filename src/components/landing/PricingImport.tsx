import { formatDuration } from '@/lib/formatDuration';
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  Loader2, 
  CheckCircle2,
  ArrowRight,
  Sparkles,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

interface ParsedService {
  name: string;
  description?: string;
  basePrice: number;
  duration: number;
  priceType: "flat" | "hourly" | "variable";
  extras?: { name: string; price: number }[];
}

interface ParsedPricing {
  services: ParsedService[];
  notes?: string;
}

export function PricingImport() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedPricing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedData(null);

    try {
      // Read file content
      const text = await file.text();
      
      const { data, error: fnError } = await supabase.functions.invoke("parse-pricing-file", {
        body: {
          fileContent: text,
          fileName: file.name,
          fileType: file.type
        }
      });

      if (fnError) {
        const { handlePossibleAiCreditError } = await import('@/components/ai-credits/AiCreditLimitModal');
        const handled = await handlePossibleAiCreditError(fnError);
        if (handled) { setIsProcessing(false); return; }
        throw new Error(fnError.message);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setParsedData(data.pricing);
      toast.success("Pricing data extracted successfully!");
    } catch (err) {
      console.error("Error processing file:", err);
      setError(err instanceof Error ? err.message : "Failed to process file");
      toast.error("Failed to process file");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleGetStarted = () => {
    // Store parsed data in session storage for the onboarding flow
    if (parsedData) {
      sessionStorage.setItem("importedPricing", JSON.stringify(parsedData));
    }
    navigate("/signup");
  };

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-secondary/30">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4">
            <Sparkles className="h-4 w-4" />
            AI-Powered Import
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Import your existing pricing in seconds
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload your pricing sheet (PDF, Word, or Excel) and our AI will automatically extract and set up your services.
          </p>
        </div>

        <Card className="border-2 border-dashed border-border hover:border-primary/50 transition-colors">
          <CardContent className="p-8">
            {!parsedData ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative rounded-xl p-12 text-center transition-all ${
                  isDragging 
                    ? "bg-primary/5 border-primary" 
                    : "bg-secondary/30"
                }`}
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-lg font-medium text-foreground">Processing your file...</p>
                    <p className="text-sm text-muted-foreground">AI is extracting pricing information</p>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-center gap-4 mb-6">
                      <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileSpreadsheet className="h-8 w-8 text-primary" />
                      </div>
                      <div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-primary" />
                      </div>
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                      Drop your pricing file here
                    </h3>
                    <p className="text-muted-foreground mb-6">
                      Supports PDF, DOC, DOCX, XLS, XLSX, and CSV files
                    </p>
                    <div className="flex items-center justify-center gap-4">
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.ppt,.pptx,.xml,.json"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="pricing-file"
                      />
                      <Button asChild size="lg">
                        <label htmlFor="pricing-file" className="cursor-pointer">
                          <Upload className="mr-2 h-4 w-4" />
                          Choose File
                        </label>
                      </Button>
                    </div>
                  </>
                )}

                {error && (
                  <div className="mt-6 p-4 bg-destructive/10 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-3 text-success">
                  <CheckCircle2 className="h-6 w-6" />
                  <span className="font-medium">Successfully extracted {parsedData.services.length} services</span>
                </div>

                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {parsedData.services.map((service, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-foreground">{service.name}</p>
                        {service.description && (
                          <p className="text-sm text-muted-foreground">{service.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">
                          ${service.basePrice.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDuration(service.duration)} • {service.priceType}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {parsedData.notes && (
                  <p className="text-sm text-muted-foreground italic">
                    Note: {parsedData.notes}
                  </p>
                )}

                <div className="flex gap-4">
                  <Button 
                    variant="outline" 
                    onClick={() => setParsedData(null)}
                    className="flex-1"
                  >
                    Upload Different File
                  </Button>
                  <Button onClick={handleGetStarted} className="flex-1">
                    Continue with These Services <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Or skip this step and set up your services manually after signing up
        </p>
      </div>
    </section>
  );
}
