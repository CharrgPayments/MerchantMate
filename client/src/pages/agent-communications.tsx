import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageSquare, 
  Bell, 
  Send, 
  User, 
  Clock, 
  Mail,
  Inbox,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  ArrowLeft
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface AgentMessage {
  id: number;
  prospectId: number;
  agentId: number | null;
  senderId: string;
  senderType: 'prospect' | 'agent';
  subject: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  prospectName: string;
  prospectEmail: string;
}

interface Agent {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export default function AgentCommunications() {
  const { toast } = useToast();
  const [selectedMessage, setSelectedMessage] = useState<AgentMessage | null>(null);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);

  // Fetch the current agent info
  const { data: agentData, isLoading: agentLoading } = useQuery<{ agent: Agent }>({
    queryKey: ['/api/agent/current'],
    queryFn: async () => {
      const res = await fetch('/api/agent/current', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch agent info');
      return res.json();
    }
  });

  const agentId = agentData?.agent?.id;

  // Fetch messages for this agent
  const { data: messagesData, isLoading: messagesLoading, refetch: refetchMessages } = useQuery<{ messages: AgentMessage[] }>({
    queryKey: ['/api/agents', agentId, 'messages'],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/messages`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    enabled: !!agentId
  });

  // Fetch unread count
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['/api/agents', agentId, 'messages', 'unread-count'],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/messages/unread-count`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch unread count');
      return res.json();
    },
    enabled: !!agentId
  });

  // Fetch notifications for agent
  const { data: notificationsData } = useQuery<{ alerts: Notification[] }>({
    queryKey: ['/api/user/alerts'],
    queryFn: async () => {
      const res = await fetch('/api/user/alerts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    }
  });

  // Mark message as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (messageId: number) => {
      return apiRequest('PATCH', `/api/agents/${agentId}/messages/${messageId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agents', agentId, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents', agentId, 'messages', 'unread-count'] });
    }
  });

  // Send reply mutation
  const sendReplyMutation = useMutation({
    mutationFn: async ({ prospectId, subject, message }: { prospectId: number; subject: string; message: string }) => {
      return apiRequest('POST', `/api/agents/${agentId}/messages`, {
        prospectId,
        subject,
        message
      });
    },
    onSuccess: () => {
      toast({ title: "Reply sent", description: "Your message has been sent to the prospect." });
      setReplySubject("");
      setReplyBody("");
      setShowReplyForm(false);
      queryClient.invalidateQueries({ queryKey: ['/api/agents', agentId, 'messages'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to send reply", variant: "destructive" });
    }
  });

  const handleSelectMessage = (msg: AgentMessage) => {
    setSelectedMessage(msg);
    setShowReplyForm(false);
    if (!msg.isRead && msg.senderType === 'prospect') {
      markAsReadMutation.mutate(msg.id);
    }
  };

  const handleReply = () => {
    if (!selectedMessage || !replySubject.trim() || !replyBody.trim()) {
      toast({ title: "Missing fields", description: "Please enter subject and message", variant: "destructive" });
      return;
    }
    sendReplyMutation.mutate({
      prospectId: selectedMessage.prospectId,
      subject: replySubject,
      message: replyBody
    });
  };

  const messages = messagesData?.messages || [];
  const notifications = notificationsData?.alerts || [];
  const unreadCount = unreadData?.count || 0;

  // Group messages by prospect for conversation view
  const groupedMessages = messages.reduce((acc, msg) => {
    const key = msg.prospectId;
    if (!acc[key]) {
      acc[key] = {
        prospectId: msg.prospectId,
        prospectName: msg.prospectName,
        prospectEmail: msg.prospectEmail,
        messages: [],
        hasUnread: false,
        lastMessage: msg
      };
    }
    acc[key].messages.push(msg);
    if (!msg.isRead && msg.senderType === 'prospect') {
      acc[key].hasUnread = true;
    }
    return acc;
  }, {} as Record<number, { prospectId: number; prospectName: string; prospectEmail: string; messages: AgentMessage[]; hasUnread: boolean; lastMessage: AgentMessage }>);

  const conversations = Object.values(groupedMessages);

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Messages Inbox - Left Side */}
      <div className="flex-1 flex flex-col border-r">
        <div className="p-4 border-b bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold">Message Inbox</h2>
              {unreadCount > 0 && (
                <Badge variant="destructive" data-testid="badge-unread-count">{unreadCount} unread</Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchMessages()} data-testid="button-refresh-messages">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Conversation List */}
          <div className="w-80 border-r bg-gray-50 flex flex-col">
            <ScrollArea className="flex-1">
              {conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No messages yet</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.prospectId}
                    className={`p-3 border-b cursor-pointer hover:bg-white transition-colors ${
                      selectedMessage?.prospectId === conv.prospectId ? 'bg-white border-l-2 border-l-blue-600' : ''
                    }`}
                    onClick={() => handleSelectMessage(conv.lastMessage)}
                    data-testid={`conversation-${conv.prospectId}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium truncate ${conv.hasUnread ? 'text-black' : 'text-gray-700'}`}>
                            {conv.prospectName}
                          </span>
                          {conv.hasUnread && (
                            <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate">{conv.lastMessage.subject}</p>
                        <p className="text-xs text-gray-400">
                          {format(new Date(conv.lastMessage.createdAt), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    </div>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>

          {/* Message Thread View */}
          <div className="flex-1 flex flex-col bg-white">
            {selectedMessage ? (
              <>
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2 mb-1">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedMessage(null)} data-testid="button-back">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h3 className="font-medium">{selectedMessage.prospectName}</h3>
                    <span className="text-sm text-gray-500">&lt;{selectedMessage.prospectEmail}&gt;</span>
                  </div>
                </div>

                <ScrollArea className="flex-1 p-4">
                  {groupedMessages[selectedMessage.prospectId]?.messages.map((msg) => (
                    <div key={msg.id} className={`mb-4 ${msg.senderType === 'agent' ? 'ml-12' : ''}`}>
                      <div className={`p-3 rounded-lg ${
                        msg.senderType === 'agent' 
                          ? 'bg-blue-50 border border-blue-100' 
                          : 'bg-gray-50 border border-gray-100'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">
                            {msg.senderType === 'agent' ? 'You' : msg.prospectName}
                          </span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(msg.createdAt), 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        <p className="font-medium text-sm mb-1">{msg.subject}</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    </div>
                  ))}
                </ScrollArea>

                {/* Reply Section */}
                <div className="p-4 border-t bg-gray-50">
                  {!showReplyForm ? (
                    <Button onClick={() => {
                      setShowReplyForm(true);
                      setReplySubject(`Re: ${selectedMessage.subject}`);
                    }} data-testid="button-reply">
                      <Send className="h-4 w-4 mr-2" /> Reply
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="reply-subject">Subject</Label>
                        <Input
                          id="reply-subject"
                          value={replySubject}
                          onChange={(e) => setReplySubject(e.target.value)}
                          placeholder="Subject"
                          data-testid="input-reply-subject"
                        />
                      </div>
                      <div>
                        <Label htmlFor="reply-body">Message</Label>
                        <Textarea
                          id="reply-body"
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Type your reply..."
                          rows={4}
                          data-testid="input-reply-body"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={handleReply} 
                          disabled={sendReplyMutation.isPending}
                          data-testid="button-send-reply"
                        >
                          {sendReplyMutation.isPending ? (
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4 mr-2" />
                          )}
                          Send Reply
                        </Button>
                        <Button variant="ghost" onClick={() => setShowReplyForm(false)} data-testid="button-cancel-reply">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Mail className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Select a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notifications Sidebar - Right Side */}
      <div className="w-80 bg-gray-50 flex flex-col">
        <div className="p-4 border-b bg-white">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold">Notifications</h2>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No notifications</p>
            </div>
          ) : (
            notifications.slice(0, 20).map((notif) => (
              <div key={notif.id} className="p-3 border-b bg-white hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    notif.isRead ? 'bg-gray-300' : 'bg-blue-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{notif.title}</p>
                    <p className="text-sm text-gray-600 line-clamp-2">{notif.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {format(new Date(notif.createdAt), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
