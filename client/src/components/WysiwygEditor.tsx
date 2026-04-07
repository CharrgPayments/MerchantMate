import { useState, useEffect, useRef } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Code, Eye } from 'lucide-react';

interface WysiwygEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
}

export function WysiwygEditor({ 
  value, 
  onChange, 
  placeholder = "Enter your email content...",
  id,
  name 
}: WysiwygEditorProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'html'>('visual');
  const [htmlContent, setHtmlContent] = useState(value);
  const quillRef = useRef<ReactQuill>(null);

  // Sync value changes from parent
  useEffect(() => {
    setHtmlContent(value);
  }, [value]);

  // Handle visual editor changes
  const handleVisualChange = (content: string) => {
    setHtmlContent(content);
    onChange(content);
  };

  // Handle HTML editor changes
  const handleHtmlChange = (content: string) => {
    setHtmlContent(content);
    onChange(content);
  };

  // Quill modules configuration
  const modules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'align': [] }],
      ['link', 'image'],
      ['clean'],
      ['code-block']
    ],
  };

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'color', 'background',
    'list', 'bullet',
    'align',
    'link', 'image',
    'code-block'
  ];

  return (
    <div className="border rounded-lg overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'visual' | 'html')} className="w-full">
        <div className="border-b bg-gray-50 dark:bg-gray-900 px-3 py-2">
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs" data-testid="tab-visual-editor">
              <Eye className="w-3 h-3 mr-1" />
              Design
            </TabsTrigger>
            <TabsTrigger value="html" className="text-xs" data-testid="tab-html-editor">
              <Code className="w-3 h-3 mr-1" />
              HTML
            </TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="visual" className="mt-0 p-0" asChild>
          <div>
            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={htmlContent}
              onChange={handleVisualChange}
              modules={modules}
              formats={formats}
              placeholder={placeholder}
              className="wysiwyg-editor"
              data-testid="wysiwyg-visual-editor"
            />
          </div>
        </TabsContent>
        
        <TabsContent value="html" className="mt-0 p-0" asChild>
          <div>
            <Textarea
              value={htmlContent}
              onChange={(e) => handleHtmlChange(e.target.value)}
              className="min-h-[300px] font-mono text-sm border-0 rounded-none focus-visible:ring-0"
              placeholder={placeholder}
              data-testid="wysiwyg-html-editor"
            />
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Hidden input for form submission */}
      <input 
        type="hidden" 
        id={id} 
        name={name} 
        value={htmlContent}
      />
    </div>
  );
}
