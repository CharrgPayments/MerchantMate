import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PenTool, Type, FileSignature, CheckCircle, Building2, User, Mail, Percent } from "lucide-react";

export default function SignatureRequest() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [typedSignature, setTypedSignature] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Get token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const signatureToken = urlParams.get('token');

  // Fetch application context for this signature request
  const { data: contextData, isLoading: contextLoading, error: contextError } = useQuery({
    queryKey: [`/api/signature-request/${signatureToken}`],
    queryFn: async () => {
      if (!signatureToken) throw new Error('No token provided');
      const response = await fetch(`/api/signature-request/${signatureToken}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!signatureToken,
  });

  if (!signatureToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-red-600">Invalid Link</CardTitle>
            <CardDescription>
              This signature request link is invalid or has expired.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (contextLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle>Loading...</CardTitle>
            <CardDescription>
              Retrieving signature request details...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (contextError || !contextData?.success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-red-600">Invalid Request</CardTitle>
            <CardDescription>
              This signature request is invalid or has expired.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const applicationContext = contextData.applicationContext;

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
  };

  const saveSignature = () => {
    if (signatureMode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      // Check if canvas has content by getting image data
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hasContent = imageData.data.some((pixel, index) => {
        // Check alpha channel (every 4th value) - if any pixel is not transparent, there's content
        return index % 4 === 3 && pixel > 0;
      });
      
      if (!hasContent) {
        toast({
          title: "No Signature",
          description: "Please draw your signature before saving.",
          variant: "destructive"
        });
        return;
      }
      
      const dataURL = canvas.toDataURL();
      setSignature(dataURL);
    } else {
      if (!typedSignature.trim()) {
        toast({
          title: "No Signature",
          description: "Please enter your name before saving.",
          variant: "destructive"
        });
        return;
      }
      setSignature(typedSignature.trim());
    }
    
    toast({
      title: "Signature Saved",
      description: "Your signature has been captured successfully.",
    });
  };

  const submitSignature = async () => {
    if (!signature) {
      toast({
        title: "No Signature",
        description: "Please provide your signature before submitting.",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/signature-submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signatureToken,
          signature,
          signatureType: signatureMode
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        toast({
          title: "Signature Submitted",
          description: "Your signature has been submitted successfully.",
        });
      } else {
        throw new Error('Failed to submit signature');
      }
    } catch (error) {
      toast({
        title: "Submission Failed",
        description: "Failed to submit your signature. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <CardTitle className="text-green-600">Signature Submitted</CardTitle>
            <CardDescription>
              Thank you! Your digital signature has been successfully submitted and recorded.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Application Details Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Merchant Application Signature Request</CardTitle>
                <CardDescription>Application details for your reference</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Company</p>
                    <p className="font-medium">{applicationContext.companyName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Applicant</p>
                    <p className="font-medium">{applicationContext.applicantName}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-600">Your Ownership</p>
                    <p className="font-medium">{applicationContext.ownershipPercentage}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Application ID: {applicationContext.applicationId}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Hello {applicationContext.ownerName},</strong> Your signature is required to complete the merchant processing application for <strong>{applicationContext.companyName}</strong>. As a business owner with {applicationContext.ownershipPercentage} ownership, your signature is legally required to proceed with the application.
              </p>
            </div>
            
            {/* Agent Contact Information */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-gray-500" />
                <p className="text-sm text-gray-600">Your assigned agent</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="font-medium">{applicationContext.agentName}</p>
                <p className="text-sm text-gray-600">{applicationContext.agentEmail}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Contact your agent if you have questions about this signature request.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signature Card */}
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <FileSignature className="w-6 h-6 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Digital Signature Required</CardTitle>
            <CardDescription>
              Please provide your digital signature to complete the merchant application process.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Signature Mode Selection */}
            <div className="flex gap-4 justify-center">
              <Button
                variant={signatureMode === 'draw' ? 'default' : 'outline'}
                onClick={() => setSignatureMode('draw')}
                className="flex items-center gap-2"
              >
                <PenTool className="w-4 h-4" />
                Draw Signature
              </Button>
              <Button
                variant={signatureMode === 'type' ? 'default' : 'outline'}
                onClick={() => setSignatureMode('type')}
                className="flex items-center gap-2"
              >
                <Type className="w-4 h-4" />
                Type Signature
              </Button>
            </div>

            {/* Draw Signature */}
            {signatureMode === 'draw' && (
              <div className="space-y-4">
                <Label className="text-base font-medium">Draw Your Signature</Label>
                <div className="border-2 border-gray-300 rounded-lg p-4 bg-white">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={200}
                    className="w-full border border-gray-200 rounded cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                  />
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" size="sm" onClick={clearCanvas}>
                      Clear
                    </Button>
                    <Button size="sm" onClick={saveSignature}>
                      Save Signature
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Type Signature */}
            {signatureMode === 'type' && (
              <div className="space-y-4">
                <Label htmlFor="typed-signature" className="text-base font-medium">
                  Type Your Full Name
                </Label>
                <Input
                  id="typed-signature"
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value)}
                  placeholder="Enter your full name"
                  className="text-lg"
                />
                {typedSignature && (
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <p className="text-sm text-gray-600 mb-2">Preview:</p>
                    <p className="text-2xl font-script italic text-blue-600">
                      {typedSignature}
                    </p>
                  </div>
                )}
                <Button onClick={saveSignature} disabled={!typedSignature.trim()}>
                  Save Signature
                </Button>
              </div>
            )}

            {/* Signature Preview */}
            {signature && (
              <div className="space-y-4">
                <Label className="text-base font-medium">Your Signature</Label>
                <div className="p-4 bg-gray-50 rounded-lg border">
                  {signatureMode === 'draw' ? (
                    <img src={signature} alt="Your signature" className="max-w-full h-auto" />
                  ) : (
                    <p className="text-2xl font-script italic text-blue-600">{signature}</p>
                  )}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-center pt-4">
              <Button
                onClick={submitSignature}
                disabled={!signature || isSubmitting}
                size="lg"
                className="w-full max-w-xs"
              >
                {isSubmitting ? "Submitting..." : "Submit Signature"}
              </Button>
            </div>

            {/* Legal Notice */}
            <div className="text-xs text-gray-500 text-center pt-4 border-t">
              <p>
                By providing your digital signature, you acknowledge and agree to the terms 
                of the merchant processing application. This signature is legally binding 
                and equivalent to a handwritten signature.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}