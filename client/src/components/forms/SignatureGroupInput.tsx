import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PenTool, Type, Mail, CheckCircle, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignatureGroupConfig {
  roleKey: string;
  label: string;
  sectionName: string;
  groupKey: string;
  prefix: string;
  fieldMappings: {
    signername?: string;
    signature?: string;
    initials?: string;
    email?: string;
    datesigned?: string;
  };
}

interface SignatureData {
  signerName: string;
  signerEmail: string;
  signature: string;
  signatureType: 'drawn' | 'typed';
  initials?: string;
  dateSigned?: string;
  ownershipPercentage?: string;
  status: 'pending' | 'requested' | 'signed' | 'expired';
  timestampSigned?: Date;
  timestampRequested?: Date;
  timestampExpires?: Date;
}

interface SignatureGroupInputProps {
  config: SignatureGroupConfig;
  value?: SignatureData;
  onChange: (data: SignatureData) => void;
  disabled?: boolean;
  dataTestId?: string;
  isRequired?: boolean;
  onRequestSignature?: (roleKey: string, email: string) => void;
  onResendRequest?: (roleKey: string) => void;
}

export function SignatureGroupInput({
  config,
  value,
  onChange,
  disabled = false,
  dataTestId,
  isRequired = false,
  onRequestSignature,
  onResendRequest,
}: SignatureGroupInputProps) {
  const [signatureType, setSignatureType] = useState<'draw' | 'type'>('draw');
  const [drawnSignature, setDrawnSignature] = useState<string>('');
  const [typedSignature, setTypedSignature] = useState<string>('');
  const [signerName, setSignerName] = useState<string>(value?.signerName || '');
  const [signerEmail, setSignerEmail] = useState<string>(value?.signerEmail || '');
  const [initials, setInitials] = useState<string>(value?.initials || '');
  const [ownershipPercentage, setOwnershipPercentage] = useState<string>(value?.ownershipPercentage || '');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);

  // Check if this is an owner signature group
  const isOwnerGroup = config.roleKey === 'owner' || config.groupKey.includes('owner');

  // Sync with value prop
  useEffect(() => {
    if (value) {
      setSignerName(value.signerName || '');
      setSignerEmail(value.signerEmail || '');
      setInitials(value.initials || '');
      setOwnershipPercentage(value.ownershipPercentage || '');
      if (value.signature) {
        if (value.signatureType === 'drawn') {
          setDrawnSignature(value.signature);
          setSignatureType('draw');
        } else {
          setTypedSignature(value.signature);
          setSignatureType('type');
        }
      }
    }
  }, [value]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = 150;

    // Set drawing styles
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Load existing signature if available
    if (drawnSignature && signatureType === 'draw') {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = drawnSignature;
    }
  }, [drawnSignature, signatureType]);

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
    if (disabled || value?.status === 'signed') return;
    
    e.preventDefault();
    setIsDrawing(true);
    const coords = getCoordinates(e);
    setLastPos(coords);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || !lastPos) return;

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
      
      // Save the signature
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

  const handleSaveSignature = () => {
    const signatureData: SignatureData = {
      signerName,
      signerEmail,
      signature: signatureType === 'draw' ? drawnSignature : typedSignature,
      signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
      initials,
      dateSigned: new Date().toISOString().split('T')[0],
      ownershipPercentage,
      status: 'signed',
      timestampSigned: new Date(),
    };

    onChange(signatureData);
  };

  const handleRequestSignature = () => {
    if (onRequestSignature && signerEmail) {
      onRequestSignature(config.roleKey, signerEmail);
    }
  };

  const handleResendRequest = () => {
    if (onResendRequest) {
      onResendRequest(config.roleKey);
    }
  };

  // Determine current status
  const status = value?.status || 'pending';
  const isExpired = status === 'expired';
  const isSigned = status === 'signed';
  const isRequested = status === 'requested';

  return (
    <Card className={cn('w-full', dataTestId)} data-testid={dataTestId}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              {config.label}
              {isRequired && <span className="text-red-500">*</span>}
            </CardTitle>
            <CardDescription>
              {isSigned && 'Signature captured'}
              {isRequested && !isExpired && 'Signature request sent'}
              {isExpired && 'Signature request expired'}
              {status === 'pending' && 'Signature required'}
            </CardDescription>
          </div>
          <div>
            {isSigned && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm font-medium">Signed</span>
              </div>
            )}
            {isRequested && !isExpired && (
              <div className="flex items-center gap-2 text-blue-600">
                <Clock className="h-5 w-5" />
                <span className="text-sm font-medium">Pending</span>
              </div>
            )}
            {isExpired && (
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm font-medium">Expired</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isSigned ? (
          // Display signed signature
          <div className="space-y-4">
            <div className={`grid ${isOwnerGroup ? 'grid-cols-4' : 'grid-cols-3'} gap-4`}>
              <div>
                <Label className="text-sm text-gray-600">Signer Name</Label>
                <p className="font-medium">{value?.signerName}</p>
              </div>
              <div>
                <Label className="text-sm text-gray-600">Email</Label>
                <p className="font-medium">{value?.signerEmail}</p>
              </div>
              {isOwnerGroup && value?.ownershipPercentage && (
                <div>
                  <Label className="text-sm text-gray-600">Ownership %</Label>
                  <p className="font-medium">{value.ownershipPercentage}%</p>
                </div>
              )}
              {value?.initials && (
                <div>
                  <Label className="text-sm text-gray-600">Initials</Label>
                  <p className="font-medium">{value.initials}</p>
                </div>
              )}
            </div>
            
            <div>
              <Label className="text-sm text-gray-600">Signature</Label>
              <div className="mt-2 p-4 border-2 border-gray-200 rounded-lg bg-white">
                {value?.signatureType === 'drawn' ? (
                  <img src={value.signature} alt="Signature" className="h-24 object-contain" />
                ) : (
                  <p className="text-3xl font-signature italic">{value?.signature}</p>
                )}
              </div>
            </div>

            {value?.dateSigned && (
              <div className="text-sm text-gray-600">
                Signed on: {new Date(value.dateSigned).toLocaleDateString()}
              </div>
            )}
          </div>
        ) : (
          // Signature capture interface
          <div className="space-y-4">
            <div className={`grid ${isOwnerGroup ? 'grid-cols-4' : 'grid-cols-3'} gap-4`}>
              <div>
                <Label htmlFor={`${config.groupKey}-name`}>
                  Signer Name {isRequired && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id={`${config.groupKey}-name`}
                  type="text"
                  value={signerName}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setSignerName(newValue);
                    
                    // Immediately update parent with current data
                    onChange({
                      signerName: newValue,
                      signerEmail,
                      signature: signatureType === 'draw' ? drawnSignature : typedSignature,
                      signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
                      initials,
                      ownershipPercentage,
                      status: value?.status || 'pending',
                      timestampSigned: value?.timestampSigned,
                      timestampRequested: value?.timestampRequested,
                      timestampExpires: value?.timestampExpires,
                    });
                  }}
                  placeholder="Enter signer name"
                  disabled={disabled || isRequested}
                  data-testid={`${dataTestId}-signer-name`}
                />
              </div>
              <div>
                <Label htmlFor={`${config.groupKey}-email`}>
                  Email {isRequired && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id={`${config.groupKey}-email`}
                  type="email"
                  value={signerEmail}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setSignerEmail(newValue);
                    
                    // Immediately update parent with current data
                    onChange({
                      signerName,
                      signerEmail: newValue,
                      signature: signatureType === 'draw' ? drawnSignature : typedSignature,
                      signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
                      initials,
                      ownershipPercentage,
                      status: value?.status || 'pending',
                      timestampSigned: value?.timestampSigned,
                      timestampRequested: value?.timestampRequested,
                      timestampExpires: value?.timestampExpires,
                    });
                  }}
                  placeholder="Enter email"
                  disabled={disabled || isRequested}
                  data-testid={`${dataTestId}-signer-email`}
                />
              </div>
              {isOwnerGroup && (
                <div>
                  <Label htmlFor={`${config.groupKey}-ownership`}>
                    Ownership % {isRequired && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id={`${config.groupKey}-ownership`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={ownershipPercentage}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setOwnershipPercentage(newValue);
                      
                      // Immediately update parent with current data including new ownership percentage
                      onChange({
                        signerName,
                        signerEmail,
                        signature: signatureType === 'draw' ? drawnSignature : typedSignature,
                        signatureType: signatureType === 'draw' ? 'drawn' : 'typed',
                        initials,
                        ownershipPercentage: newValue,
                        status: value?.status || 'pending',
                        timestampSigned: value?.timestampSigned,
                        timestampRequested: value?.timestampRequested,
                        timestampExpires: value?.timestampExpires,
                      });
                    }}
                    placeholder="25.0"
                    disabled={disabled || isRequested}
                    data-testid={`${dataTestId}-ownership`}
                  />
                </div>
              )}
              <div>
                <Label htmlFor={`${config.groupKey}-initials`}>
                  Initials
                </Label>
                <Input
                  id={`${config.groupKey}-initials`}
                  type="text"
                  value={initials}
                  onChange={(e) => setInitials(e.target.value)}
                  placeholder="e.g. JD"
                  maxLength={4}
                  disabled={disabled || isRequested}
                  data-testid={`${dataTestId}-initials`}
                />
              </div>
            </div>

            {!isRequested && (
              <>
                <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as 'draw' | 'type')}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="draw" data-testid={`${dataTestId}-tab-draw`}>
                      <PenTool className="h-4 w-4 mr-2" />
                      Draw Signature
                    </TabsTrigger>
                    <TabsTrigger value="type" data-testid={`${dataTestId}-tab-type`}>
                      <Type className="h-4 w-4 mr-2" />
                      Type Signature
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="draw" className="mt-4">
                    <div className="space-y-2">
                      <Label>Draw your signature below</Label>
                      <div className="border-2 border-gray-300 rounded-lg bg-white relative">
                        <canvas
                          ref={canvasRef}
                          className="w-full cursor-crosshair touch-none"
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={startDrawing}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                          data-testid={`${dataTestId}-canvas`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearCanvas}
                        data-testid={`${dataTestId}-clear-canvas`}
                      >
                        Clear
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="type" className="mt-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${config.groupKey}-typed`}>Type your full name</Label>
                      <Input
                        id={`${config.groupKey}-typed`}
                        type="text"
                        value={typedSignature}
                        onChange={(e) => setTypedSignature(e.target.value)}
                        placeholder="John Doe"
                        className="text-3xl font-signature italic"
                        data-testid={`${dataTestId}-typed-input`}
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="flex justify-end gap-2">
                  {onRequestSignature && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRequestSignature}
                      disabled={!signerEmail || disabled}
                      data-testid={`${dataTestId}-request-btn`}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Request Signature via Email
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleSaveSignature}
                    disabled={
                      disabled ||
                      !signerName ||
                      !signerEmail ||
                      (signatureType === 'draw' && !drawnSignature) ||
                      (signatureType === 'type' && !typedSignature)
                    }
                    data-testid={`${dataTestId}-save-btn`}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Save Signature
                  </Button>
                </div>
              </>
            )}

            {isRequested && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-blue-900">Signature request sent</p>
                    <p className="text-sm text-blue-700 mt-1">
                      An email has been sent to {value?.signerEmail} with instructions to complete the signature.
                    </p>
                    {value?.timestampExpires && (
                      <p className="text-sm text-blue-600 mt-2">
                        Expires: {new Date(value.timestampExpires).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {isExpired && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-900">Signature request expired</p>
                      <p className="text-sm text-red-700 mt-1">
                        The signature request sent to {value?.signerEmail} has expired.
                      </p>
                    </div>
                  </div>
                  {onResendRequest && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResendRequest}
                      data-testid={`${dataTestId}-resend-btn`}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Resend
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
