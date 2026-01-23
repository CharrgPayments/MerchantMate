import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Check, 
  Lock, 
  ChevronDown, 
  PenTool, 
  Type,
  AlertCircle,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DisclosureConfig {
  key: string;
  disclosureSlug: string;
  displayLabel: string;
  sectionName: string;
  orderPriority: number;
  isRequired: boolean;
  requiresSignature: boolean;
  requiresInitials: boolean;
  linkedSignatureGroupKey?: string;
}

interface DisclosureContent {
  id: number;
  name: string;
  slug: string;
  title: string;
  content: string;
  version: string;
}

interface DisclosureData {
  scrollStartedAt?: string;
  scrollCompletedAt?: string;
  scrollDurationMs?: number;
  scrollPercentage: number;
  acknowledged: boolean;
  signature?: {
    signerName: string;
    signatureData: string;
    signatureType: 'drawn' | 'typed';
    email: string;
    dateSigned: string;
  };
  initials?: {
    value: string;
    signerName: string;
    dateInitialed: string;
  };
}

interface DisclosureFieldProps {
  config: DisclosureConfig;
  content: DisclosureContent;
  value?: DisclosureData;
  onChange: (data: DisclosureData) => void;
  disabled?: boolean;
  dataTestId?: string;
}

export function DisclosureField({
  config,
  content,
  value,
  onChange,
  disabled = false,
  dataTestId,
}: DisclosureFieldProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollStartTime = useRef<number | null>(null);
  
  const [scrollPercentage, setScrollPercentage] = useState(value?.scrollPercentage || 0);
  const [hasCompletedScroll, setHasCompletedScroll] = useState(value?.scrollPercentage === 100);
  const [isAcknowledged, setIsAcknowledged] = useState(value?.acknowledged || false);
  
  const [signatureType, setSignatureType] = useState<'draw' | 'type'>('draw');
  const [drawnSignature, setDrawnSignature] = useState<string>('');
  const [typedSignature, setTypedSignature] = useState<string>('');
  const [signerName, setSignerName] = useState<string>(value?.signature?.signerName || '');
  const [signerEmail, setSignerEmail] = useState<string>(value?.signature?.email || '');
  
  const [initials, setInitials] = useState<string>(value?.initials?.value || '');
  const [initialsSignerName, setInitialsSignerName] = useState<string>(value?.initials?.signerName || '');
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);

  const SCROLL_THRESHOLD = 95;

  useEffect(() => {
    if (value) {
      setScrollPercentage(value.scrollPercentage || 0);
      setHasCompletedScroll(value.scrollPercentage >= SCROLL_THRESHOLD);
      setIsAcknowledged(value.acknowledged || false);
      if (value.signature) {
        setSignerName(value.signature.signerName || '');
        setSignerEmail(value.signature.email || '');
        if (value.signature.signatureType === 'drawn') {
          setDrawnSignature(value.signature.signatureData || '');
        } else {
          setTypedSignature(value.signature.signatureData || '');
        }
      }
      if (value.initials) {
        setInitials(value.initials.value || '');
        setInitialsSignerName(value.initials.signerName || '');
      }
    }
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = 120;

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (drawnSignature && signatureType === 'draw') {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = drawnSignature;
    }
  }, [drawnSignature, signatureType]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (disabled || isAcknowledged) return;

    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight - target.clientHeight;
    const percentage = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;

    if (!scrollStartTime.current) {
      scrollStartTime.current = Date.now();
    }

    if (percentage > scrollPercentage) {
      setScrollPercentage(percentage);
      
      if (percentage >= SCROLL_THRESHOLD && !hasCompletedScroll) {
        setHasCompletedScroll(true);
        const scrollDurationMs = Date.now() - (scrollStartTime.current || Date.now());
        
        onChange({
          ...value,
          scrollStartedAt: value?.scrollStartedAt || new Date().toISOString(),
          scrollCompletedAt: new Date().toISOString(),
          scrollDurationMs,
          scrollPercentage: 100,
          acknowledged: false,
        });
      } else {
        onChange({
          ...value,
          scrollStartedAt: value?.scrollStartedAt || new Date().toISOString(),
          scrollPercentage: percentage,
          acknowledged: false,
        });
      }
    }
  }, [disabled, isAcknowledged, scrollPercentage, hasCompletedScroll, value, onChange]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled || !hasCompletedScroll) return;
    e.preventDefault();
    setIsDrawing(true);
    const pos = getCoordinates(e);
    setLastPos(pos);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled || !hasCompletedScroll) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !lastPos) return;

    const pos = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setLastPos(pos);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setLastPos(null);
      const canvas = canvasRef.current;
      if (canvas) {
        const signature = canvas.toDataURL('image/png');
        setDrawnSignature(signature);
        updateSignatureData(signature, 'drawn');
      }
    }
  };

  const updateSignatureData = (signatureData: string, type: 'drawn' | 'typed') => {
    if (!hasCompletedScroll || disabled) return;
    
    const startTime = value?.scrollStartedAt || (scrollStartTime.current ? new Date(scrollStartTime.current).toISOString() : new Date().toISOString());
    
    onChange({
      ...value,
      scrollStartedAt: startTime,
      scrollCompletedAt: value?.scrollCompletedAt || new Date().toISOString(),
      scrollDurationMs: value?.scrollDurationMs || 0,
      scrollPercentage: scrollPercentage,
      acknowledged: false,
      signature: {
        signerName,
        signatureData,
        signatureType: type,
        email: signerEmail,
        dateSigned: '',
      },
    });
  };

  const handleSignerNameChange = (name: string) => {
    setSignerName(name);
    const currentSignature = signatureType === 'draw' ? drawnSignature : typedSignature;
    if (currentSignature && hasCompletedScroll) {
      updateSignatureData(currentSignature, signatureType === 'draw' ? 'drawn' : 'typed');
    }
  };

  const handleSignerEmailChange = (email: string) => {
    setSignerEmail(email);
    const currentSignature = signatureType === 'draw' ? drawnSignature : typedSignature;
    if (currentSignature && hasCompletedScroll) {
      updateSignatureData(currentSignature, signatureType === 'draw' ? 'drawn' : 'typed');
    }
  };

  const handleTypedSignatureChange = (typed: string) => {
    setTypedSignature(typed);
    if (typed && hasCompletedScroll) {
      updateSignatureData(typed, 'typed');
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setDrawnSignature('');
    setTypedSignature('');
    
    onChange({
      ...value,
      scrollStartedAt: value?.scrollStartedAt,
      scrollCompletedAt: value?.scrollCompletedAt,
      scrollDurationMs: value?.scrollDurationMs || 0,
      scrollPercentage: scrollPercentage,
      acknowledged: false,
      signature: undefined,
    });
  };

  const handleAcknowledge = () => {
    if (!hasCompletedScroll || disabled) return;

    const signatureData = signatureType === 'draw' ? drawnSignature : typedSignature;
    
    if (config.requiresSignature && (!signatureData || !signerName)) {
      return;
    }

    if (config.requiresInitials && (!initials || !initialsSignerName)) {
      return;
    }

    const acknowledgedData: DisclosureData = {
      ...value,
      scrollStartedAt: value?.scrollStartedAt || new Date().toISOString(),
      scrollCompletedAt: value?.scrollCompletedAt || new Date().toISOString(),
      scrollDurationMs: value?.scrollDurationMs || 0,
      scrollPercentage: 100,
      acknowledged: true,
      signature: config.requiresSignature ? {
        signerName,
        signatureData,
        signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
        email: signerEmail,
        dateSigned: new Date().toISOString(),
      } : undefined,
      initials: config.requiresInitials ? {
        value: initials,
        signerName: initialsSignerName,
        dateInitialed: new Date().toISOString(),
      } : undefined,
    };

    setIsAcknowledged(true);
    onChange(acknowledgedData);
  };

  const signatureValid = !config.requiresSignature || 
    ((signatureType === 'draw' ? drawnSignature : typedSignature) && signerName);
  
  const initialsValid = !config.requiresInitials || (initials && initialsSignerName);

  const canAcknowledge = hasCompletedScroll && signatureValid && initialsValid;

  return (
    <Card 
      className={cn(
        "w-full transition-all duration-200",
        isAcknowledged && "border-green-300 bg-green-50/30",
        !hasCompletedScroll && "border-amber-200"
      )}
      data-testid={dataTestId || `disclosure-${config.key}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{config.displayLabel}</CardTitle>
          </div>
          {isAcknowledged ? (
            <Badge className="bg-green-100 text-green-800" data-testid={`disclosure-${config.key}-status-acknowledged`}>
              <Check className="h-3 w-3 mr-1" />
              Acknowledged
            </Badge>
          ) : hasCompletedScroll ? (
            <Badge className="bg-blue-100 text-blue-800" data-testid={`disclosure-${config.key}-status-read`}>
              <Check className="h-3 w-3 mr-1" />
              Read - Sign Below
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300" data-testid={`disclosure-${config.key}-status-pending`}>
              <ChevronDown className="h-3 w-3 mr-1" />
              Scroll to Read
            </Badge>
          )}
        </div>
        <CardDescription>
          {content.title} (Version {content.version})
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="relative">
          <div
            ref={scrollRef}
            className={cn(
              "h-64 overflow-y-auto border rounded-md p-4 bg-white",
              disabled && "opacity-60",
              isAcknowledged && "pointer-events-none"
            )}
            onScroll={handleScroll}
            data-testid={`disclosure-${config.key}-content`}
          >
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: content.content }}
            />
          </div>
          
          {!hasCompletedScroll && !isAcknowledged && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none flex items-end justify-center pb-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <ChevronDown className="h-4 w-4 animate-bounce" />
                Scroll to continue reading
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Reading progress</span>
            <span className="font-medium">{scrollPercentage}%</span>
          </div>
          <Progress 
            value={scrollPercentage} 
            className={cn(
              "h-2",
              hasCompletedScroll && "bg-green-100"
            )}
            data-testid={`disclosure-${config.key}-progress`}
          />
        </div>

        {config.requiresSignature && (
          <>
            <Separator />
            
            <div className={cn(
              "space-y-4 transition-opacity duration-300",
              !hasCompletedScroll && "opacity-50 pointer-events-none"
            )}>
              {!hasCompletedScroll && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-md border border-amber-200">
                  <Lock className="h-4 w-4 text-amber-600" />
                  <span className="text-sm text-amber-700">
                    Complete reading the disclosure to unlock signature
                  </span>
                </div>
              )}

              {hasCompletedScroll && !isAcknowledged && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${config.key}-signer-name`}>Full Legal Name</Label>
                      <Input
                        id={`${config.key}-signer-name`}
                        value={signerName}
                        onChange={(e) => handleSignerNameChange(e.target.value)}
                        placeholder="Enter your full legal name"
                        disabled={disabled}
                        data-testid={`disclosure-${config.key}-signer-name`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${config.key}-signer-email`}>Email Address</Label>
                      <Input
                        id={`${config.key}-signer-email`}
                        type="email"
                        value={signerEmail}
                        onChange={(e) => handleSignerEmailChange(e.target.value)}
                        placeholder="Enter your email address"
                        disabled={disabled}
                        data-testid={`disclosure-${config.key}-signer-email`}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Signature</Label>
                    <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as 'draw' | 'type')}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="draw" className="flex items-center gap-2">
                          <PenTool className="h-4 w-4" />
                          Draw
                        </TabsTrigger>
                        <TabsTrigger value="type" className="flex items-center gap-2">
                          <Type className="h-4 w-4" />
                          Type
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="draw" className="mt-2">
                        <div className="border rounded-md p-2 bg-white">
                          <canvas
                            ref={canvasRef}
                            className="w-full cursor-crosshair touch-none"
                            style={{ height: '120px' }}
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                            data-testid={`disclosure-${config.key}-signature-canvas`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearSignature}
                          className="mt-2"
                          data-testid={`disclosure-${config.key}-clear-signature`}
                        >
                          Clear Signature
                        </Button>
                      </TabsContent>

                      <TabsContent value="type" className="mt-2">
                        <Input
                          value={typedSignature}
                          onChange={(e) => handleTypedSignatureChange(e.target.value)}
                          placeholder="Type your full name as signature"
                          className="font-signature text-xl italic"
                          disabled={disabled}
                          data-testid={`disclosure-${config.key}-typed-signature`}
                        />
                      </TabsContent>
                    </Tabs>
                  </div>
                </>
              )}

              {isAcknowledged && value?.signature && (
                <div className="p-4 bg-green-50 rounded-md border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-800">Disclosure Acknowledged & Signed</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Signed by:</span>
                      <p className="font-medium">{value.signature.signerName}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Date signed:</span>
                      <p className="font-medium">
                        {new Date(value.signature.dateSigned).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {value.scrollDurationMs && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Reading time: {Math.round(value.scrollDurationMs / 1000)} seconds
                    </div>
                  )}
                </div>
              )}
            </div>

            {hasCompletedScroll && !isAcknowledged && !signatureValid && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4" />
                Please enter your name and signature to acknowledge
              </div>
            )}
          </>
        )}

        {config.requiresInitials && (
          <>
            <Separator />
            
            <div className={cn(
              "space-y-4 transition-opacity duration-300",
              !hasCompletedScroll && "opacity-50 pointer-events-none"
            )}>
              {!hasCompletedScroll && !config.requiresSignature && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-md border border-amber-200">
                  <Lock className="h-4 w-4 text-amber-600" />
                  <span className="text-sm text-amber-700">
                    Complete reading the disclosure to provide your initials
                  </span>
                </div>
              )}

              {hasCompletedScroll && !isAcknowledged && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Type className="h-4 w-4 text-primary" />
                    <span className="font-medium">Initials Required</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${config.key}-initials-name`}>Full Name</Label>
                      <Input
                        id={`${config.key}-initials-name`}
                        value={initialsSignerName}
                        onChange={(e) => setInitialsSignerName(e.target.value)}
                        placeholder="Enter your full name"
                        disabled={disabled}
                        data-testid={`disclosure-${config.key}-initials-name`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${config.key}-initials`}>Your Initials</Label>
                      <Input
                        id={`${config.key}-initials`}
                        value={initials}
                        onChange={(e) => setInitials(e.target.value.toUpperCase())}
                        placeholder="e.g., JD"
                        maxLength={5}
                        className="font-bold text-lg uppercase tracking-wider"
                        disabled={disabled}
                        data-testid={`disclosure-${config.key}-initials`}
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter your initials (first and last name initials)
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {isAcknowledged && value?.initials && (
                <div className="p-4 bg-green-50 rounded-md border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-800">Initials Recorded</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Initialed by:</span>
                      <p className="font-medium">{value.initials.signerName}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Initials:</span>
                      <p className="font-bold text-lg">{value.initials.value}</p>
                    </div>
                  </div>
                </div>
              )}

              {hasCompletedScroll && !isAcknowledged && !initialsValid && (
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  Please enter your name and initials to acknowledge
                </div>
              )}
            </div>
          </>
        )}

        {!config.requiresSignature && !config.requiresInitials && hasCompletedScroll && !isAcknowledged && (
          <Button
            onClick={handleAcknowledge}
            disabled={disabled}
            className="w-full"
            data-testid={`disclosure-${config.key}-acknowledge-btn`}
          >
            <Check className="h-4 w-4 mr-2" />
            I Have Read and Acknowledge {config.displayLabel}
          </Button>
        )}

        {(config.requiresSignature || config.requiresInitials) && hasCompletedScroll && !isAcknowledged && (
          <Button
            onClick={handleAcknowledge}
            disabled={disabled || !canAcknowledge}
            className="w-full"
            data-testid={`disclosure-${config.key}-acknowledge-btn`}
          >
            <Check className="h-4 w-4 mr-2" />
            I Have Read and Agree to {config.displayLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export type { DisclosureConfig, DisclosureContent, DisclosureData };
