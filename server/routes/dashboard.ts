import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { userDashboardPreferences } from "@shared/schema";
import { ROLE_WIDGET_PERMISSIONS, getDefaultLayout, canUserAccessWidget, validateWidgetConfig, type WidgetType } from "@shared/widget-schema";
import { insertUserDashboardPreferenceSchema } from "@shared/schema";
import { z } from "zod";
import { dbEnvironmentMiddleware, type RequestWithDB } from "../dbMiddleware";
import { isAuthenticated } from "../replitAuth";

const router = Router();

// Apply auth and database environment middleware to all routes
router.use(isAuthenticated);
router.use(dbEnvironmentMiddleware);

// Get user's dashboard widget preferences
router.get("/widgets", async (req: RequestWithDB, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const user = req.user!;
    
    if (!userId || !user) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }
    
    console.log(`Dashboard API - Getting widgets for user ${userId} with role ${user.role}`);
    
    // Get user's current widget preferences
    const widgets = await req.db.select()
      .from(userDashboardPreferences)
      .where(eq(userDashboardPreferences.user_id, userId))
      .orderBy(userDashboardPreferences.position);
    
    // If user has no widgets, initialize with default layout for their role
    if (widgets.length === 0) {
      const defaultLayout = getDefaultLayout(user.role);
      console.log(`Dashboard API - Initializing default layout for role ${user.role}:`, defaultLayout);
      
      if (defaultLayout.length > 0) {
        // Insert default widgets
        const defaultWidgets = defaultLayout.map(widget => ({
          user_id: userId,
          widget_id: widget.widgetId,
          position: widget.position,
          size: widget.size,
          is_visible: true,
          configuration: widget.configuration || {},
        }));
        
        const insertedWidgets = await req.db.insert(userDashboardPreferences)
          .values(defaultWidgets)
          .returning();
        
        console.log(`Dashboard API - Created ${insertedWidgets.length} default widgets`);
        return res.json(insertedWidgets);
      }
    }
    
    // Filter widgets to only those the user's role can access
    const allowedWidgets = widgets.filter(widget => 
      canUserAccessWidget(user.role, widget.widget_id as WidgetType)
    );
    
    console.log(`Dashboard API - Returning ${allowedWidgets.length} widgets`);
    res.json(allowedWidgets);
  } catch (error) {
    console.error("Dashboard API - Error fetching widgets:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch dashboard widgets",
      error: process.env.NODE_ENV === 'development' ? error : undefined 
    });
  }
});

// Add a new widget to user's dashboard
router.post("/widgets", async (req: RequestWithDB, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const user = req.user!;
    
    console.log(`Dashboard API - Request details: userId=${userId}, user=${JSON.stringify(user)}`);
    
    if (!userId || !user) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }
    
    const addWidgetSchema = z.object({
      widgetId: z.string(),
      position: z.number().default(0),
      size: z.enum(['small', 'medium', 'large']).default('medium'),
      isVisible: z.boolean().default(true),
      configuration: z.record(z.any()).default({}),
    });
    
    const validatedData = addWidgetSchema.parse(req.body);
    console.log(`Dashboard API - Adding widget ${validatedData.widgetId} for user ${userId}`);
    
    // Check if user's role can access this widget
    if (!canUserAccessWidget(user.role, validatedData.widgetId as WidgetType)) {
      return res.status(403).json({ 
        success: false, 
        message: "Widget not available for your role" 
      });
    }
    
    // Validate widget configuration
    const configValidation = validateWidgetConfig(validatedData.widgetId as WidgetType, validatedData.configuration);
    if (!configValidation.success) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid widget configuration",
        errors: configValidation.success ? undefined : 'Invalid configuration'
      });
    }
    
    // Check if user already has this widget
    const existingWidget = await req.db.select()
      .from(userDashboardPreferences)
      .where(and(
        eq(userDashboardPreferences.user_id, userId),
        eq(userDashboardPreferences.widget_id, validatedData.widgetId)
      ))
      .limit(1);
    
    if (existingWidget.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: "Widget already exists on dashboard" 
      });
    }
    
    const widgetData = {
      user_id: userId,
      widget_id: validatedData.widgetId,
      position: validatedData.position,
      size: validatedData.size,
      is_visible: validatedData.isVisible,
      configuration: validatedData.configuration,
    };
    
    console.log(`Dashboard API - Inserting widget data:`, widgetData);
    const [newWidget] = await req.db.insert(userDashboardPreferences)
      .values(widgetData)
      .returning();
    
    console.log(`Dashboard API - Successfully added widget:`, newWidget);
    res.status(201).json(newWidget);
  } catch (error) {
    console.error("Dashboard API - Error adding widget:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to add widget",
      error: process.env.NODE_ENV === 'development' ? error : undefined 
    });
  }
});

// Update widget preferences (position, size, visibility, configuration)
router.patch("/widgets/:id", async (req: RequestWithDB, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const widgetId = parseInt(req.params.id);
    
    console.log(`Dashboard API - Updating widget ${widgetId} for user ${userId}:`, req.body);
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required - user ID not found" 
      });
    }
    
    const updateSchema = z.object({
      position: z.number().optional(),
      size: z.enum(['small', 'medium', 'large']).optional(),
      isVisible: z.boolean().optional(),
      configuration: z.record(z.any()).optional(),
    });
    
    const validatedData = updateSchema.parse(req.body);
    
    // Verify widget belongs to user
    const database = req.db || req.dynamicDB;
    if (!database) {
      console.error('Dashboard API - No database connection available');
      return res.status(500).json({ 
        success: false, 
        message: "Database connection error" 
      });
    }
    
    const widget = await database.select()
      .from(userDashboardPreferences)
      .where(and(
        eq(userDashboardPreferences.id, widgetId),
        eq(userDashboardPreferences.user_id, userId)
      ))
      .limit(1);
    
    if (widget.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Widget not found" 
      });
    }
    
    // Validate configuration if provided
    if (validatedData.configuration) {
      const configValidation = validateWidgetConfig(widget[0].widget_id as WidgetType, validatedData.configuration);
      if (!configValidation.success) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid widget configuration",
          errors: configValidation.success ? undefined : 'Invalid configuration'
        });
      }
    }
    
    // Map frontend property names to database column names
    const updateData: any = {
      updated_at: new Date(),
    };
    
    if (validatedData.position !== undefined) updateData.position = validatedData.position;
    if (validatedData.size !== undefined) updateData.size = validatedData.size;
    if (validatedData.isVisible !== undefined) updateData.is_visible = validatedData.isVisible;
    if (validatedData.configuration !== undefined) updateData.configuration = validatedData.configuration;
    
    console.log(`Dashboard API - Update data being sent to database:`, updateData);
    console.log(`Dashboard API - Original validated data:`, validatedData);
    
    const [updatedWidget] = await database.update(userDashboardPreferences)
      .set(updateData)
      .where(eq(userDashboardPreferences.id, widgetId))
      .returning();
    
    console.log(`Dashboard API - Successfully updated widget:`, updatedWidget);
    res.json(updatedWidget);
  } catch (error) {
    console.error("Dashboard API - Error updating widget:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update widget",
      error: process.env.NODE_ENV === 'development' ? error : undefined 
    });
  }
});

// Remove widget from dashboard
router.delete("/widgets/:id", async (req: RequestWithDB, res) => {
  try {
    const userId = req.userId!;
    const widgetId = parseInt(req.params.id);
    
    console.log(`Dashboard API - Removing widget ${widgetId} for user ${userId}`);
    
    // Verify widget belongs to user and delete
    const deletedWidget = await req.db.delete(userDashboardPreferences)
      .where(and(
        eq(userDashboardPreferences.id, widgetId),
        eq(userDashboardPreferences.user_id, userId)
      ))
      .returning();
    
    if (deletedWidget.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Widget not found" 
      });
    }
    
    console.log(`Dashboard API - Successfully removed widget:`, deletedWidget[0]);
    res.json({ 
      success: true, 
      message: "Widget removed successfully" 
    });
  } catch (error) {
    console.error("Dashboard API - Error removing widget:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to remove widget",
      error: process.env.NODE_ENV === 'development' ? error : undefined 
    });
  }
});

// Get available widgets for user's role
router.get("/available-widgets", async (req: RequestWithDB, res) => {
  try {
    const user = req.user!;
    const availableWidgets = ROLE_WIDGET_PERMISSIONS[user.role as keyof typeof ROLE_WIDGET_PERMISSIONS] || [];
    
    console.log(`Dashboard API - Available widgets for role ${user.role}:`, availableWidgets.length);
    
    res.json({
      success: true,
      role: user.role,
      widgets: availableWidgets,
    });
  } catch (error) {
    console.error("Dashboard API - Error fetching available widgets:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch available widgets",
      error: process.env.NODE_ENV === 'development' ? error : undefined 
    });
  }
});

export { router as dashboardRouter };