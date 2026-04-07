import { BaseWidget } from "./BaseWidget";
import { WidgetProps } from "./widget-types";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { User, Mail, Shield, Calendar, Crown } from "lucide-react";

export function ProfileSummaryWidget(props: WidgetProps) {
  const { user } = useAuth();

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'bg-red-100 text-red-800';
      case 'admin': return 'bg-purple-100 text-purple-800';
      case 'corporate': return 'bg-blue-100 text-blue-800';
      case 'agent': return 'bg-green-100 text-green-800';
      case 'merchant': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatRole = (role: string) => {
    return role.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <BaseWidget {...props} isLoading={!user}>
      <div className="space-y-4">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-100 p-2 rounded-lg">
            <User className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <h3 className="font-semibold text-gray-900">{user?.email?.split('@')[0] || 'User'}</h3>
              {/* Super Admin Crown Badge */}
              {(user as any)?.roles?.includes('super_admin') && (
                <Crown className="w-4 h-4 text-yellow-500" title="Super Administrator" />
              )}
            </div>
            <Badge className={getRoleBadgeColor((user as any)?.roles?.[0] || 'user')}>
              {formatRole((user as any)?.roles?.[0] || 'user')}
            </Badge>
          </div>
        </div>

        {props.preference.configuration?.showDetails !== false && (
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-sm">
              <Mail className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">{user?.email}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm">
              <Shield className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">
                {user?.twoFactorEnabled ? 'Two-Factor Enabled' : 'Two-Factor Disabled'}
              </span>
            </div>
            {user?.lastLoginAt && (
              <div className="flex items-center space-x-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span className="text-gray-600">
                  Last login: {new Date(user.lastLoginAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="pt-2 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Account Status:</span>
            <span className="font-medium text-green-600">Active</span>
          </div>
        </div>
      </div>
    </BaseWidget>
  );
}