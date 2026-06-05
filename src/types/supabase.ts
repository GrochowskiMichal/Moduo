export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      calendar_events: {
        Row: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_time: string
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          start_time: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          all_day?: boolean
          attendees?: Json
          calendar_id?: string
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_time: string
          id?: string
          location?: string | null
          owner_id: string
          recurrence_rule?: string | null
          recurring?: boolean
          reminders?: Json
          start_time: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          all_day?: boolean
          attendees?: Json
          calendar_id?: string
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_time?: string
          id?: string
          location?: string | null
          owner_id?: string
          recurrence_rule?: string | null
          recurring?: boolean
          reminders?: Json
          start_time?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_layouts: {
        Row: {
          created_at: string
          id: string
          layout_data: Json
          layout_key: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          layout_data?: Json
          layout_key: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          layout_data?: Json
          layout_key?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_layouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_layouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      exposed_notes: {
        Row: {
          content_b64: string
          content_text: string
          embeds_json: Json | null
          exposed_at: string
          id: string
          note_id: string
          slug: string
          title: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          content_b64?: string
          content_text?: string
          embeds_json?: Json | null
          exposed_at?: string
          id?: string
          note_id: string
          slug: string
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          content_b64?: string
          content_text?: string
          embeds_json?: Json | null
          exposed_at?: string
          id?: string
          note_id?: string
          slug?: string
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      exposed_slot_links: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          conflict_calendars: string
          created_at: string
          date_range_days: number
          description: string
          duration_minutes: number
          id: string
          link_name: string
          location_type: string
          name: string
          owner_avatar_url: string | null
          owner_display_name: string | null
          owner_email: string | null
          owner_handle: string
          owner_user_id: string
          questions_json: Json
          schedule_type: string
          slot_id: string
          slug: string
          updated_at: string
          video_provider: string | null
          workspace_id: string | null
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          description?: string
          duration_minutes?: number
          id?: string
          link_name?: string
          location_type?: string
          name?: string
          owner_avatar_url?: string | null
          owner_display_name?: string | null
          owner_email?: string | null
          owner_handle?: string
          owner_user_id: string
          questions_json?: Json
          schedule_type?: string
          slot_id: string
          slug: string
          updated_at?: string
          video_provider?: string | null
          workspace_id?: string | null
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          description?: string
          duration_minutes?: number
          id?: string
          link_name?: string
          location_type?: string
          name?: string
          owner_avatar_url?: string | null
          owner_display_name?: string | null
          owner_email?: string | null
          owner_handle?: string
          owner_user_id?: string
          questions_json?: Json
          schedule_type?: string
          slot_id?: string
          slug?: string
          updated_at?: string
          video_provider?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      founders_interest: {
        Row: {
          coupon_code: string | null
          coupon_sent_at: string | null
          created_at: string
          email: string
          id: string
          message: string | null
          submitted_at: string
        }
        Insert: {
          coupon_code?: string | null
          coupon_sent_at?: string | null
          created_at?: string
          email: string
          id?: string
          message?: string | null
          submitted_at?: string
        }
        Update: {
          coupon_code?: string | null
          coupon_sent_at?: string | null
          created_at?: string
          email?: string
          id?: string
          message?: string | null
          submitted_at?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          id: string
          icon: string | null
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          id?: string
          icon?: string | null
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          id?: string
          icon?: string | null
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_layouts: {
        Row: {
          created_at: string
          id: string
          layout_data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          layout_data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          layout_data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "panel_layouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cloud_linked: boolean
          created_at: string
          current_period_end: string | null
          display_name: string
          id: string
          local_user_id: string | null
          plan_tier: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at: string | null
          recovery_seed_hash: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cloud_linked?: boolean
          created_at?: string
          current_period_end?: string | null
          display_name?: string
          id: string
          local_user_id?: string | null
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at?: string | null
          recovery_seed_hash?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cloud_linked?: boolean
          created_at?: string
          current_period_end?: string | null
          display_name?: string
          id?: string
          local_user_id?: string | null
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at?: string | null
          recovery_seed_hash?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      slot_bookings: {
        Row: {
          attendee_email: string
          attendee_name: string
          attendee_notes: string | null
          calendar_synced: boolean
          created_at: string
          end_at: string
          id: string
          meeting_id: string | null
          meeting_link: string | null
          slot_id: string
          slot_slug: string
          start_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          attendee_email?: string
          attendee_name?: string
          attendee_notes?: string | null
          calendar_synced?: boolean
          created_at?: string
          end_at: string
          id?: string
          meeting_id?: string | null
          meeting_link?: string | null
          slot_id: string
          slot_slug: string
          start_at: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          attendee_email?: string
          attendee_name?: string
          attendee_notes?: string | null
          calendar_synced?: boolean
          created_at?: string
          end_at?: string
          id?: string
          meeting_id?: string | null
          meeting_link?: string | null
          slot_id?: string
          slot_slug?: string
          start_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      slot_conflict_windows: {
        Row: {
          end_at: string
          id: string
          slot_id: string
          slot_slug: string
          source_calendar_id: string
          source_event_id: string
          start_at: string
          updated_at: string
        }
        Insert: {
          end_at: string
          id?: string
          slot_id: string
          slot_slug: string
          source_calendar_id: string
          source_event_id: string
          start_at: string
          updated_at?: string
        }
        Update: {
          end_at?: string
          id?: string
          slot_id?: string
          slot_slug?: string
          source_calendar_id?: string
          source_event_id?: string
          start_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          customer_id: string | null
          event_type: string
          id: string
          payload: Json | null
          processed_at: string
          stripe_event_id: string
          subscription_id: string | null
        }
        Insert: {
          customer_id?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          processed_at?: string
          stripe_event_id: string
          subscription_id?: string | null
        }
        Update: {
          customer_id?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string
          stripe_event_id?: string
          subscription_id?: string | null
        }
        Relationships: []
      }
      tasks_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_items"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_items: {
        Row: {
          assigned_to: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          id: string
          position: number
          priority: number
          project_id: string
          state_id: string | null
          tags: Json
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          id?: string
          position?: number
          priority?: number
          project_id: string
          state_id?: string | null
          tags?: Json
          title?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          id?: string
          position?: number
          priority?: number
          project_id?: string
          state_id?: string | null
          tags?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "tasks_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_items_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "tasks_states"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_projects: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_states: {
        Row: {
          color: string
          created_at: string
          id: string
          is_done: boolean
          name: string
          position: number
          project_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          name: string
          position?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_done?: boolean
          name?: string
          position?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "tasks_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_integrations: {
        Row: {
          access_token_enc: string
          created_at: string
          id: string
          provider: string
          refresh_token_enc: string | null
          token_expiry: string | null
          updated_at: string
          user_id: string
          zoom_account_id: string | null
        }
        Insert: {
          access_token_enc: string
          created_at?: string
          id?: string
          provider: string
          refresh_token_enc?: string | null
          token_expiry?: string | null
          updated_at?: string
          user_id: string
          zoom_account_id?: string | null
        }
        Update: {
          access_token_enc?: string
          created_at?: string
          id?: string
          provider?: string
          refresh_token_enc?: string | null
          token_expiry?: string | null
          updated_at?: string
          user_id?: string
          zoom_account_id?: string | null
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: string | null
          referrer: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: string | null
          referrer?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          referrer?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          permissions_notes: string
          permissions_tasks: string
          role: string
          status: string
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          permissions_notes?: string
          permissions_tasks?: string
          role?: string
          status?: string
          token?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          permissions_notes?: string
          permissions_tasks?: string
          role?: string
          status?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          joined_at: string
          permissions_notes: string
          permissions_tasks: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          permissions_notes?: string
          permissions_tasks?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          permissions_notes?: string
          permissions_tasks?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json | null
          read_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json | null
          read_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          read_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      plan_tier: "free" | "pro" | "team" | "founder"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      plan_tier: ["free", "pro", "team", "founder"],
    },
  },
} as const
