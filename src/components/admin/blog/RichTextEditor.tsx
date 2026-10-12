import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Button } from "@/components/ui/button";
import { promptDialog } from "@/components/AppDialogs";
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3,
  Quote, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Code,
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
      Image,
    ],
    content: value || "<p></p>",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose-base max-w-none dark:prose-invert focus:outline-none min-h-[400px] p-4",
      },
    },
  });

  if (!editor) return null;

  const addLink = () => {
    void promptDialog("Enter URL").then((url) => {
      if (!url) return;
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    });
  };

  const addImage = () => {
    void promptDialog("Enter image URL").then((url) => {
      if (!url) return;
      editor.chain().focus().setImage({ src: url }).run();
    });
  };

  return (
    <div className="border border-border rounded-lg bg-background">
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        <Button type="button" variant={editor.isActive("bold") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("italic") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("heading", { level: 2 }) ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("heading", { level: 3 }) ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("bulletList") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("orderedList") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("blockquote") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Button>
        <Button type="button" variant={editor.isActive("codeBlock") ? "secondary" : "ghost"} size="sm" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={addLink}><LinkIcon className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={addImage}><ImageIcon className="h-4 w-4" /></Button>
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => editor.chain().focus().undo().run()}><Undo className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => editor.chain().focus().redo().run()}><Redo className="h-4 w-4" /></Button>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
