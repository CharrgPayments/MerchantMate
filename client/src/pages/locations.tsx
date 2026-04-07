import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Plus, Phone, Mail, DollarSign, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { insertLocationSchema, insertAddressSchema, type InsertLocation, type InsertAddress, type LocationWithAddresses } from "@shared/schema";
import { formatPhoneNumber, unformatPhoneNumber } from "@/lib/utils";
import { z } from "zod";

// Extend location schema with phone validation
const locationFormSchema = insertLocationSchema.superRefine((data, ctx) => {
  if (data.phone && unformatPhoneNumber(data.phone).length !== 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Phone number must be exactly 10 digits",
      path: ["phone"],
    });
  }
});

// Revenue metrics component
function LocationRevenue({ locationId }: { locationId: number }) {
  const { data: revenue, isLoading, error } = useQuery<{
    totalRevenue: string;
    last24Hours: string;
    monthToDate: string;
    yearToDate: string;
  }>({
    queryKey: [`/api/locations/${locationId}/revenue`],
    enabled: !!locationId,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(`/api/locations/${locationId}/revenue`, {
        credentials: "include",
        mode: "cors"
      });
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return await res.json();
    }
  });

  console.log('Revenue debug:', { locationId, revenue, isLoading, error, hasData: !!revenue });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading revenue...</div>;
  }

  if (error) {
    console.error('Revenue API error:', error);
    return <div className="text-sm text-muted-foreground">Error loading revenue data</div>;
  }

  if (!revenue || !revenue.totalRevenue) {
    console.log('No revenue data received for location:', locationId);
    return <div className="text-sm text-muted-foreground">No revenue data</div>;
  }

  return (
    <div className="space-y-3 mt-4 pt-4 border-t">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4" />
        Revenue Metrics
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Total Revenue</div>
          <div className="font-semibold">${revenue.totalRevenue}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Last 24 Hours</div>
          <div className="font-semibold text-green-600">${revenue.last24Hours}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Month to Date</div>
          <div className="font-semibold">${revenue.monthToDate}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Year to Date</div>
          <div className="font-semibold">${revenue.yearToDate}</div>
        </div>
      </div>
    </div>
  );
}

export default function LocationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationWithAddresses | null>(null);

  // Get merchant ID for the current user
  const merchantId = user?.role === 'merchant' ? 1 : 1; // TODO: Get actual merchant ID from user

  const { data: locations = [], isLoading } = useQuery<LocationWithAddresses[]>({
    queryKey: ['/api/merchants', merchantId, 'locations'],
    queryFn: async () => {
      const res = await fetch(`/api/merchants/${merchantId}/locations`);
      if (!res.ok) {
        throw new Error('Failed to fetch locations');
      }
      return res.json();
    },
  });

  const locationForm = useForm<InsertLocation>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      merchantId,
      name: "",
      type: "store",
      mid: "",
      phone: "",
      email: "",
    },
  });

  const addressForm = useForm<InsertAddress>({
    resolver: zodResolver(insertAddressSchema),
    defaultValues: {
      locationId: 0,
      type: "billing",
      street1: "",
      street2: "",
      city: "",
      state: "",
      zipCode: "",
      country: "US",
      latitude: undefined,
      longitude: undefined,
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: (data: InsertLocation) => fetch(`/api/merchants/${merchantId}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/merchants', merchantId, 'locations'] });
      setIsLocationDialogOpen(false);
      locationForm.reset();
      toast({ title: "Success", description: "Location created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating location", description: error.message, variant: "destructive" });
    },
  });

  const createAddressMutation = useMutation({
    mutationFn: (data: InsertAddress) => fetch(`/api/locations/${data.locationId}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/merchants', merchantId, 'locations'] });
      setIsAddressDialogOpen(false);
      addressForm.reset();
      toast({ title: "Success", description: "Address added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error adding address", description: error.message, variant: "destructive" });
    },
  });

  const onLocationSubmit = (data: InsertLocation) => {
    createLocationMutation.mutate(data);
  };

  const onAddressSubmit = (data: InsertAddress) => {
    if (selectedLocation) {
      createAddressMutation.mutate({ ...data, locationId: selectedLocation.id });
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading locations...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <Card className="corecrm-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Locations</CardTitle>
            <Dialog open={isLocationDialogOpen} onOpenChange={setIsLocationDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Location
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Location</DialogTitle>
                  <DialogDescription>
                    Create a new business location with a unique MID for transaction tracking.
                  </DialogDescription>
                </DialogHeader>
                <Form {...locationForm}>
                  <form onSubmit={locationForm.handleSubmit(onLocationSubmit)} className="space-y-4">
                    <FormField
                      control={locationForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Main Store" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={locationForm.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="store">Store</SelectItem>
                              <SelectItem value="warehouse">Warehouse</SelectItem>
                              <SelectItem value="office">Office</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={locationForm.control}
                      name="mid"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>MID (Merchant ID)</FormLabel>
                          <FormControl>
                            <Input placeholder="MID-STORE-001" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={locationForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="(555) 555-5555" 
                                value={field.value || ""}
                                onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={locationForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="store@example.com" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={createLocationMutation.isPending}>
                        {createLocationMutation.isPending ? "Creating..." : "Create Location"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {locations.map((location: LocationWithAddresses) => (
              <Card key={location.id} className="relative">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5" />
                      {location.name}
                    </CardTitle>
                    <Badge variant={location.status === "active" ? "default" : "secondary"}>
                      {location.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {location.type} • MID: {location.mid || "Not assigned"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {location.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        <span>{location.phone}</span>
                      </div>
                    )}
                    {location.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        <span>{location.email}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Revenue Metrics Section */}
                  <LocationRevenue locationId={location.id} />
                  
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Addresses</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedLocation(location);
                          setIsAddressDialogOpen(true);
                        }}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    {location.addresses && location.addresses.length > 0 ? (
                      <div className="space-y-2">
                        {location.addresses.map((address) => (
                          <div key={address.id} className="p-2 bg-gray-50 rounded text-xs">
                            <div className="font-medium">{address.type}</div>
                            <div>{address.street1}</div>
                            <div>{address.city}, {address.state} {address.zipCode}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">No addresses added</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add Address Dialog */}
      <Dialog open={isAddressDialogOpen} onOpenChange={setIsAddressDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Address</DialogTitle>
            <DialogDescription>
              Add a new address to {selectedLocation?.name}
            </DialogDescription>
          </DialogHeader>
          <Form {...addressForm}>
            <form onSubmit={addressForm.handleSubmit(onAddressSubmit)} className="space-y-4">
              <FormField
                control={addressForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="billing">Billing</SelectItem>
                        <SelectItem value="shipping">Shipping</SelectItem>
                        <SelectItem value="physical">Physical</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addressForm.control}
                name="street1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addressForm.control}
                name="street2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address 2 (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Suite 100" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addressForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="New York" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addressForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="NY" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addressForm.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code</FormLabel>
                      <FormControl>
                        <Input placeholder="10001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addressForm.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                        <Input placeholder="US" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addressForm.control}
                  name="latitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitude (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="any" 
                          placeholder="40.7128" 
                          {...field} 
                          value={field.value || ""} 
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addressForm.control}
                  name="longitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitude (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="any" 
                          placeholder="-74.0060" 
                          {...field} 
                          value={field.value || ""} 
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createAddressMutation.isPending}>
                  {createAddressMutation.isPending ? "Adding..." : "Add Address"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}