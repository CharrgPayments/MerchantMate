import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  PenTool, 
  Type, 
  Mail, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  RotateCcw,
  Send,
  Link2,
  User
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SignatureEnvelope } from '@shared/schema';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface LinkedFieldInfo {
  fieldId: string;
  fieldLabel: string;
  fieldType: string;
  sectionTitle?: string;
}

interface EnhancedSignatureFieldProps {
  fieldName: string;
  fieldLabel: string;
  value?: SignatureEnvelope | null;
  onChange: (data: SignatureEnvelope) => void;
  disabled?: boolean;
  isRequired?: boolean;
  applicationId?: number;
  linkedFields?: LinkedFieldInfo[];
  dataTestId?: string;
}

const SIGNATURE_FONTS = [
  { name: 'Dancing Script', style: 'Dancing Script, cursive' },
  { name: 'Great Vibes', style: 'Great Vibes, cursive' },
  { name: 'Pacifico', style: 'Pacifico, cursive' },
  { name: 'Caveat', style: 'Caveat, cursive' },
];

export function EnhancedSignatureField({
  fieldName,
  fieldLabel,
  value,
  onChange,
  disabled = false,
  isRequired = false,
  applicationId,
  linkedFields = [],
  dataTestId,
}: EnhancedSignatureFieldProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [signatureType, setSignatureType] = useState<'draw' | 'type'>('draw');
  const [signerName, setSignerName] = useState(value?.signerName || '');
  const [signerEmail, setSignerEmail] = useState(value?.signerEmail || '');
  const [drawnSignature, setDrawnSignature] = useState(value?.signatureType === 'drawn' ? value?.signature || '' : '');
  const [typedSignature, setTypedSignature] = useState(value?.signatureType === 'typed' ? value?.signature || '' : '');
  const [selectedFont, setSelectedFont] = useState(value?.typedFontStyle || SIGNATURE_FONTS[0].style);
  
  // Linked fields are now pre-configured in the template - extract field IDs for storage
  const linkedFieldIds = linkedFields.map(f => f.fieldId);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);

  const status = value?.status || 'pending';
  const isSigned = status === 'signed';
  const isRequested = status === 'requested';
  const isExpired = status === 'expired';
  const isLocked = isSigned || isRequested; // Lock editing when signed or request is pending

  useEffect(() => {
    if (value) {
      setSignerName(value.signerName || '');
      setSignerEmail(value.signerEmail || '');
      if (value.signature) {
        if (value.signatureType === 'drawn') {
          setDrawnSignature(value.signature);
          setSignatureType('draw');
        } else {
          setTypedSignature(value.signature);
          setSignatureType('type');
          if (value.typedFontStyle) setSelectedFont(value.typedFontStyle);
        }
      }
    }
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = 150;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (drawnSignature && signatureType === 'draw') {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = drawnSignature;
    }
  }, [drawnSignature, signatureType]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled || isSigned) return;
    e.preventDefault();
    setIsDrawing(true);
    setLastPos(getCoordinates(e));
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current || !lastPos) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const coords = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setLastPos(coords);
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      setIsDrawing(false);
      setLastPos(null);
      const dataUrl = canvasRef.current.toDataURL('image/png');
      setDrawnSignature(dataUrl);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawnSignature('');
  };

  const generateTypedSignatureSVG = useCallback((name: string, font: string): string => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script&family=Great+Vibes&family=Pacifico&family=Caveat&display=swap');
      </style>
      <text x="10" y="60" font-family="${font}" font-size="40" fill="#000">${name}</text>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }, []);

  const handleSaveSignature = () => {
    if (!signerName.trim()) {
      toast({ title: 'Name required', description: 'Please enter your full name', variant: 'destructive' });
      return;
    }
    
    const signature = signatureType === 'draw' ? drawnSignature : generateTypedSignatureSVG(signerName, selectedFont);
    
    if (!signature || (signatureType === 'draw' && !drawnSignature)) {
      toast({ title: 'Signature required', description: 'Please draw or type your signature', variant: 'destructive' });
      return;
    }

    const envelope: SignatureEnvelope = {
      signerName,
      signerEmail,
      signature,
      signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
      typedFontStyle: signatureType === 'type' ? selectedFont : undefined,
      status: 'signed',
      linkedDisclosures: linkedFieldIds,
      signedAt: new Date().toISOString(),
      auditTrail: {
        timestamp: new Date().toISOString(),
      },
    };

    onChange(envelope);
    toast({ title: 'Signature saved', description: 'Your signature has been captured successfully' });
  };

  const sendSignatureRequestMutation = useMutation({
    mutationFn: async (data: { email: string; name: string; fieldName: string; applicationId?: number; linkedDisclosures: string[] }) => {
      return apiRequest('POST', '/api/signatures/request', data);
    },
    onSuccess: (response: any) => {
      toast({ title: 'Request sent', description: `Signature request sent to ${signerEmail}` });
      // Use the signatureEnvelope returned from the backend with requestToken and proper status
      if (response.signatureEnvelope) {
        onChange(response.signatureEnvelope);
      } else {
        // Fallback if backend doesn't return envelope
        const envelope: SignatureEnvelope = {
          signerName,
          signerEmail,
          signature: '',
          signatureType: 'drawn',
          status: 'requested',
          linkedDisclosures: linkedFieldIds,
          requestedAt: new Date().toISOString(),
        };
        onChange(envelope);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to send request', description: error.message, variant: 'destructive' });
    },
  });

  const handleSendForSignature = () => {
    if (!signerEmail.trim()) {
      toast({ title: 'Email required', description: 'Please enter an email address', variant: 'destructive' });
      return;
    }
    if (!signerName.trim()) {
      toast({ title: 'Name required', description: 'Please enter the signer\'s name', variant: 'destructive' });
      return;
    }
    
    sendSignatureRequestMutation.mutate({
      email: signerEmail,
      name: signerName,
      fieldName,
      applicationId,
      linkedDisclosures: linkedFieldIds,
    });
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'signed':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" /> Signed</Badge>;
      case 'requested':
        return <Badge className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" /> Awaiting Signature</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" /> Expired</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
  };

  return (
    <Card className={cn("w-full", disabled && "opacity-60")} data-testid={dataTestId}>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            {fieldLabel}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {getStatusBadge()}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${fieldName}-name`} className="text-xs text-muted-foreground flex items-center gap-1">
              <User className="w-3 h-3" /> Full Name
            </Label>
            <Input
              id={`${fieldName}-name`}
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Enter full legal name"
              disabled={disabled || isLocked}
              data-testid={`${fieldName}-signer-name`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldName}-email`} className="text-xs text-muted-foreground flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email Address
            </Label>
            <Input
              id={`${fieldName}-email`}
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="Enter email address"
              disabled={disabled || isLocked}
              data-testid={`${fieldName}-signer-email`}
            />
          </div>
        </div>

        {linkedFields.length > 0 && (
          <div className="space-y-2 p-3 bg-slate-50 rounded-lg border">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Link2 className="w-3 h-3" /> This signature acknowledges the following fields:
            </Label>
            <div className="flex flex-wrap gap-2">
              {linkedFields.map((field) => (
                <Badge key={field.fieldId} variant="secondary" className="text-xs">
                  {field.fieldLabel}
                  {field.sectionTitle && <span className="text-muted-foreground ml-1">({field.sectionTitle})</span>}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {isRequested && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-blue-800">
              <Clock className="w-4 h-4" />
              <span className="font-medium">Signature request pending</span>
            </div>
            <p className="text-sm text-blue-700 mt-1">
              An email has been sent to {signerEmail || 'the signer'}. Waiting for their signature.
            </p>
            {value?.requestToken && (
              <p className="text-xs text-blue-600 mt-2">Request ID: {value.requestToken.slice(0, 8)}...</p>
            )}
          </div>
        )}

        {isExpired && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">Signature request expired</span>
            </div>
            <p className="text-sm text-red-700 mt-1">
              The signature request has expired. You can send a new request.
            </p>
          </div>
        )}

        {!isLocked && !isExpired && (
          <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as 'draw' | 'type')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="draw" className="flex items-center gap-2">
                <PenTool className="w-4 h-4" /> Draw Signature
              </TabsTrigger>
              <TabsTrigger value="type" className="flex items-center gap-2">
                <Type className="w-4 h-4" /> Type Signature
              </TabsTrigger>
            </TabsList>

            <TabsContent value="draw" className="mt-4">
              <div className="border rounded-lg p-2 bg-white">
                <canvas
                  ref={canvasRef}
                  className="w-full border border-gray-200 rounded cursor-crosshair bg-white touch-none"
                  style={{ height: '150px' }}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  data-testid={`${fieldName}-canvas`}
                />
                <div className="flex justify-between items-center mt-2">
                  <p className="text-xs text-muted-foreground">Draw your signature above</p>
                  <Button type="button" variant="ghost" size="sm" onClick={clearCanvas}>
                    <RotateCcw className="w-4 h-4 mr-1" /> Clear
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="type" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Select a signature style</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SIGNATURE_FONTS.map((font) => (
                    <button
                      key={font.name}
                      type="button"
                      onClick={() => setSelectedFont(font.style)}
                      className={cn(
                        "p-3 border rounded-lg text-left transition-colors",
                        selectedFont === font.style 
                          ? "border-primary bg-primary/5" 
                          : "border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <span 
                        style={{ fontFamily: font.style, fontSize: '24px' }}
                        className="block truncate"
                      >
                        {signerName || 'Your Name'}
                      </span>
                      <span className="text-xs text-muted-foreground">{font.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="p-4 border rounded-lg bg-white">
                <p className="text-xs text-muted-foreground mb-2">Preview</p>
                <div 
                  className="text-4xl py-4 border-b-2 border-gray-300"
                  style={{ fontFamily: selectedFont }}
                >
                  {signerName || 'Your signature will appear here'}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {isSigned && value?.signature && (
          <div className="p-4 border rounded-lg bg-green-50">
            <p className="text-xs text-muted-foreground mb-2">Captured Signature</p>
            {value.signatureType === 'drawn' ? (
              <img src={value.signature} alt="Signature" className="max-h-24" />
            ) : (
              <div style={{ fontFamily: value.typedFontStyle }} className="text-4xl">
                {value.signerName}
              </div>
            )}
            {value.signedAt && (
              <p className="text-xs text-muted-foreground mt-2">
                Signed on {new Date(value.signedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {!isSigned && !isRequested && (
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              type="button"
              onClick={handleSaveSignature}
              disabled={disabled || (!drawnSignature && signatureType === 'draw') || !signerName.trim()}
              data-testid={`${fieldName}-save-btn`}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Save Signature
            </Button>
            
            <Button
              type="button"
              variant="outline"
              onClick={handleSendForSignature}
              disabled={disabled || !signerEmail.trim() || !signerName.trim() || sendSignatureRequestMutation.isPending}
              data-testid={`${fieldName}-send-btn`}
            >
              <Send className="w-4 h-4 mr-2" />
              {sendSignatureRequestMutation.isPending ? 'Sending...' : (isExpired ? 'Resend Request' : 'Send for Signature')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
