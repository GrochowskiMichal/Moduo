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
      buckets: {
        Row: {
          created_at: string
          deleted_at: string | null
          group_label: string | null
          id: string
          is_system: boolean
          name: string
          owner_id: string | null
          position: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          group_label?: string | null
          id?: string
          is_system?: boolean
          name: string
          owner_id?: string | null
          position?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          group_label?: string | null
          id?: string
          is_system?: boolean
          name?: string
          owner_id?: string | null
          position?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buckets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_accounts: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          display_label: string
          external_id: string
          id: string
          is_default_target: boolean
          last_sync_at: string | null
          owner_id: string | null
          provider: string
          status: string
          sync_token: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          display_label?: string
          external_id?: string
          id?: string
          is_default_target?: boolean
          last_sync_at?: string | null
          owner_id?: string | null
          provider: string
          status?: string
          sync_token?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          display_label?: string
          external_id?: string
          id?: string
          is_default_target?: boolean
          last_sync_at?: string | null
          owner_id?: string | null
          provider?: string
          status?: string
          sync_token?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
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
          external_event_id: string | null
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          source_account_id: string | null
          start_time: string
          status: string
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
          external_event_id?: string | null
          id?: string
          location?: string | null
          owner_id: string
          recurrence_rule?: string | null
          recurring?: boolean
          reminders?: Json
          source_account_id?: string | null
          start_time: string
          status?: string
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
          external_event_id?: string | null
          id?: string
          location?: string | null
          owner_id?: string
          recurrence_rule?: string | null
          recurring?: boolean
          reminders?: Json
          source_account_id?: string | null
          start_time?: string
          status?: string
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
            foreignKeyName: "calendar_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_events_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "calendar_accounts"
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
      comments: {
        Row: {
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_kind?: string
          author_label?: string | null
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_kind?: string
          author_label?: string | null
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_workspace_id_entity_type_entity_id_fkey"
            columns: ["workspace_id", "entity_type", "entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["workspace_id", "entity_type", "entity_id"]
          },
          {
            foreignKeyName: "comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          avatar_url: string | null
          created_at: string
          custom: Json
          deleted_at: string | null
          domains: string[]
          id: string
          name: string
          notes_inline: string
          owner_id: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          custom?: Json
          deleted_at?: string | null
          domains?: string[]
          id?: string
          name?: string
          notes_inline?: string
          owner_id?: string | null
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          custom?: Json
          deleted_at?: string | null
          domains?: string[]
          id?: string
          name?: string
          notes_inline?: string
          owner_id?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_field_defs: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          options: Json
          position: number
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label?: string
          options?: Json
          position?: number
          type?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          label?: string
          options?: Json
          position?: number
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_field_defs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        Insert: {
          addresses?: Json
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          custom?: Json
          dates?: Json
          deleted_at?: string | null
          email?: string | null
          emails?: Json
          id?: string
          is_favorite?: boolean
          name?: string
          notes_inline?: string
          owner_id?: string | null
          phone?: string | null
          phones?: Json
          status?: string
          title?: string | null
          updated_at?: string
          urls?: Json
          workspace_id: string
        }
        Update: {
          addresses?: Json
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          custom?: Json
          dates?: Json
          deleted_at?: string | null
          email?: string | null
          emails?: Json
          id?: string
          is_favorite?: boolean
          name?: string
          notes_inline?: string
          owner_id?: string | null
          phone?: string | null
          phones?: Json
          status?: string
          title?: string | null
          updated_at?: string
          urls?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
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
            foreignKeyName: "dashboard_layouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
      email_accounts: {
        Row: {
          address: string
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          owner_id: string
          provider: string
          signature_html: string
          status: string
          unread_count: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address: string
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          owner_id?: string
          provider: string
          signature_html?: string
          status?: string
          unread_count?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          owner_id?: string
          provider?: string
          signature_html?: string
          status?: string
          unread_count?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_refs: {
        Row: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          deleted_at?: string | null
          follow_up_at?: string | null
          follow_up_cleared_at?: string | null
          follow_up_notified_at?: string | null
          from_addr?: string | null
          from_name?: string | null
          id?: string
          is_snoozed?: boolean
          message_key?: string | null
          owner_id?: string
          sent_at?: string | null
          snippet?: string
          snooze_until?: string | null
          subject?: string
          thread_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          deleted_at?: string | null
          follow_up_at?: string | null
          follow_up_cleared_at?: string | null
          follow_up_notified_at?: string | null
          from_addr?: string | null
          from_name?: string | null
          id?: string
          is_snoozed?: boolean
          message_key?: string | null
          owner_id?: string
          sent_at?: string | null
          snippet?: string
          snooze_until?: string | null
          subject?: string
          thread_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_refs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_refs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          deleted_at: string | null
          entity_id: string
          entity_type: string
          icon: string | null
          label: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          entity_id: string
          entity_type: string
          icon?: string | null
          label?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          entity_id?: string
          entity_type?: string
          icon?: string | null
          label?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_links: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          origin?: string
          pair_key?: string | null
          relation_kind?: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          origin?: string
          pair_key?: string | null
          relation_kind?: string
          source_id?: string
          source_type?: string
          target_id?: string
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_workspace_id_source_type_source_id_fkey"
            columns: ["workspace_id", "source_type", "source_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["workspace_id", "entity_type", "entity_id"]
          },
          {
            foreignKeyName: "entity_links_workspace_id_target_type_target_id_fkey"
            columns: ["workspace_id", "target_type", "target_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["workspace_id", "entity_type", "entity_id"]
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
          busy_calendar_ids: Json
          conflict_calendars: string
          created_at: string
          date_range_days: number
          description: string
          duration_minutes: number
          host_timezone: string
          id: string
          link_name: string
          location_type: string
          min_notice_minutes: number
          guests_enabled: boolean
          name: string
          note_enabled: boolean
          owner_avatar_url: string | null
          owner_display_name: string | null
          owner_email: string | null
          owner_handle: string
          owner_user_id: string
          paused: boolean
          questions_json: Json
          schedule_type: string
          slot_id: string
          slug: string
          updated_at: string
          video_provider: string | null
          weekly_hours: Json
          workspace_id: string | null
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          busy_calendar_ids?: Json
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          description?: string
          duration_minutes?: number
          host_timezone?: string
          id?: string
          link_name?: string
          location_type?: string
          min_notice_minutes?: number
          guests_enabled?: boolean
          name?: string
          note_enabled?: boolean
          owner_avatar_url?: string | null
          owner_display_name?: string | null
          owner_email?: string | null
          owner_handle?: string
          owner_user_id: string
          paused?: boolean
          questions_json?: Json
          schedule_type?: string
          slot_id: string
          slug: string
          updated_at?: string
          video_provider?: string | null
          weekly_hours?: Json
          workspace_id?: string | null
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          busy_calendar_ids?: Json
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          description?: string
          duration_minutes?: number
          host_timezone?: string
          id?: string
          link_name?: string
          location_type?: string
          min_notice_minutes?: number
          guests_enabled?: boolean
          name?: string
          note_enabled?: boolean
          owner_avatar_url?: string | null
          owner_display_name?: string | null
          owner_email?: string | null
          owner_handle?: string
          owner_user_id?: string
          paused?: boolean
          questions_json?: Json
          schedule_type?: string
          slot_id?: string
          slug?: string
          updated_at?: string
          video_provider?: string | null
          weekly_hours?: Json
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
      habits: {
        Row: {
          checks: Json
          created_at: string
          emoji: string
          id: string
          name: string
          position: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          checks?: Json
          created_at?: string
          emoji?: string
          id?: string
          name: string
          position?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          checks?: Json
          created_at?: string
          emoji?: string
          id?: string
          name?: string
          position?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "habits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      link_suggestion_declines: {
        Row: {
          created_at: string
          declined_by: string | null
          id: string
          pair_key: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          declined_by?: string | null
          id?: string
          pair_key: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          declined_by?: string | null
          id?: string
          pair_key?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_suggestion_declines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      module_activity: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          actor_type: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          module: string
          op: string
          payload: Json
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          actor_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          module: string
          op: string
          payload?: Json
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          actor_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          module?: string
          op?: string
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_shares: {
        Row: {
          created_at: string
          id: string
          note_id: string
          permission: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          permission?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          permission?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_shares_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "note_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_updates: {
        Row: {
          client_id: string
          client_seq: number
          created_at: string
          id: number
          note_id: string
          update_b64: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          client_seq: number
          created_at?: string
          id?: never
          note_id: string
          update_b64: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          client_seq?: number
          created_at?: string
          id?: never
          note_id?: string
          update_b64?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_updates_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_updates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body_md?: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          doc_version?: number
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          publish_token?: string | null
          published_at?: string | null
          search_tsv?: unknown
          share_permission?: string
          share_scope?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body_md?: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          doc_version?: number
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          publish_token?: string | null
          published_at?: string | null
          search_tsv?: unknown
          share_permission?: string
          share_scope?: string
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
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
      notification_state: {
        Row: {
          activity_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          read_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          read_at?: string | null
          user_id?: string
          workspace_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          read_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_state_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "module_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_state_workspace_id_fkey"
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
          {
            foreignKeyName: "panel_layouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
          answers_json: Json
          attendee_email: string
          attendee_name: string
          attendee_notes: string | null
          calendar_event_id: string | null
          calendar_synced: boolean
          cancel_token: string | null
          contact_id: string | null
          created_at: string
          end_at: string
          guest_emails: Json
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
          answers_json?: Json
          attendee_email?: string
          attendee_name?: string
          attendee_notes?: string | null
          calendar_event_id?: string | null
          calendar_synced?: boolean
          cancel_token?: string | null
          contact_id?: string | null
          created_at?: string
          end_at: string
          guest_emails?: Json
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
          answers_json?: Json
          attendee_email?: string
          attendee_name?: string
          attendee_notes?: string | null
          calendar_event_id?: string | null
          calendar_synced?: boolean
          cancel_token?: string | null
          contact_id?: string | null
          created_at?: string
          end_at?: string
          guest_emails?: Json
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
      tag_links: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          tag_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          tag_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          tag_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_relations: {
        Row: {
          blocked_task_id: string
          blocker_task_id: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          blocked_task_id: string
          blocker_task_id: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          blocked_task_id?: string
          blocker_task_id?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_relations_blocked_task_id_fkey"
            columns: ["blocked_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_blocked_task_id_fkey"
            columns: ["blocked_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_drift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_blocker_task_id_fkey"
            columns: ["blocker_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_blocker_task_id_fkey"
            columns: ["blocker_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_drift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_blocks: {
        Row: {
          blocks: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          blocks?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          blocks?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_blocks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bucket_id: string
          commit_order?: number | null
          committed_for?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          id?: string
          owner_id?: string | null
          parent_id?: string | null
          position?: string
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number
          scheduled_at?: string | null
          status?: string
          time_spent_seconds?: number
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bucket_id?: string
          commit_order?: number | null
          committed_for?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_date?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          id?: string
          owner_id?: string | null
          parent_id?: string | null
          position?: string
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number
          scheduled_at?: string | null
          status?: string
          time_spent_seconds?: number
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_drift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "tasks_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "tasks_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
          account_key: string
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
          account_key?: string
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
          account_key?: string
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
      user_preferences: {
        Row: {
          appearance: Json
          appearance_updated_at: string
          calendar: Json
          calendar_updated_at: string
          created_at: string
          email: Json
          email_updated_at: string
          focus: Json
          focus_updated_at: string
          preferences: Json
          preferences_updated_at: string
          user_id: string
        }
        Insert: {
          appearance?: Json
          appearance_updated_at?: string
          calendar?: Json
          calendar_updated_at?: string
          created_at?: string
          email?: Json
          email_updated_at?: string
          focus?: Json
          focus_updated_at?: string
          preferences?: Json
          preferences_updated_at?: string
          user_id: string
        }
        Update: {
          appearance?: Json
          appearance_updated_at?: string
          calendar?: Json
          calendar_updated_at?: string
          created_at?: string
          email?: Json
          email_updated_at?: string
          focus?: Json
          focus_updated_at?: string
          preferences?: Json
          preferences_updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          referrer: string | null
          source: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      waitlist_attempts: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip_hash: string
        }
        Update: {
          created_at?: string
          id?: never
          ip_hash?: string
        }
        Relationships: []
      }
      workspace_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "workspace_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
          permissions_email: string | null
          permissions_notes: string
          permissions_tasks: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          permissions_email?: string | null
          permissions_notes?: string
          permissions_tasks?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          permissions_email?: string | null
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
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "workspace_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
          icon: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          logo_url?: string | null
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
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      tasks_with_drift: {
        Row: {
          bucket_id: string | null
          commit_order: number | null
          committed_for: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          drifted: boolean | null
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string | null
          owner_id: string | null
          position: string | null
          priority: string | null
          recurrence: Json | null
          reschedule_count: number | null
          scheduled_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          bucket_id?: string | null
          commit_order?: number | null
          committed_for?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          drifted?: never
          due_date?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          id?: string | null
          owner_id?: string | null
          position?: string | null
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          bucket_id?: string | null
          commit_order?: number | null
          committed_for?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          drifted?: never
          due_date?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          id?: string | null
          owner_id?: string | null
          position?: string | null
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_entitlements: {
        Row: {
          current_period_end: string | null
          plan_tier: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_days_remaining: number | null
          trial_ends_at: string | null
          user_id: string | null
          has_access: boolean | null
        }
        Insert: {
          current_period_end?: string | null
          plan_tier?: never
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_days_remaining?: never
          trial_ends_at?: never
          user_id?: string | null
        }
        Update: {
          current_period_end?: string | null
          plan_tier?: never
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_days_remaining?: never
          trial_ends_at?: never
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_workspace_invite: { Args: { p_invite_id: string }; Returns: Json }
      calendar_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      calendar_op__guard: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      calendar_op__guard_event: {
        Args: {
          p_event_id: string
          p_native_only?: boolean
          p_workspace_id: string
        }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_time: string
          external_event_id: string | null
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          source_account_id: string | null
          start_time: string
          status: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_op_account_remove: {
        Args: { p_account_id: string; p_workspace_id: string }
        Returns: undefined
      }
      calendar_op_account_upsert: {
        Args: {
          p_color?: string
          p_display_label: string
          p_external_id: string
          p_last_sync_at?: string
          p_provider: string
          p_status?: string
          p_sync_token?: string
          p_workspace_id: string
        }
        Returns: {
          color: string | null
          created_at: string
          deleted_at: string | null
          display_label: string
          external_id: string
          id: string
          is_default_target: boolean
          last_sync_at: string | null
          owner_id: string | null
          provider: string
          status: string
          sync_token: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "calendar_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_op_event_create: {
        Args: {
          p_all_day?: boolean
          p_description?: string
          p_ends_at: string
          p_rrule?: string
          p_starts_at: string
          p_title: string
          p_workspace_id: string
        }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_time: string
          external_event_id: string | null
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          source_account_id: string | null
          start_time: string
          status: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_op_event_delete: {
        Args: { p_event_id: string; p_workspace_id: string }
        Returns: undefined
      }
      calendar_op_event_restore: {
        Args: { p_event_id: string; p_workspace_id: string }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_time: string
          external_event_id: string | null
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          source_account_id: string | null
          start_time: string
          status: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_op_event_update: {
        Args: { p_event_id: string; p_patch: Json; p_workspace_id: string }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_time: string
          external_event_id: string | null
          id: string
          location: string | null
          owner_id: string
          recurrence_rule: string | null
          recurring: boolean
          reminders: Json
          source_account_id: string | null
          start_time: string
          status: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calendar_op_mirror_events: {
        Args: {
          p_account_id: string
          p_deleted_external_ids?: string[]
          p_events: Json
          p_workspace_id: string
        }
        Returns: Json
      }
      comments_op_add: {
        Args: {
          p_body: string
          p_entity_icon?: string
          p_entity_id: string
          p_entity_label?: string
          p_entity_type: string
          p_mentioned_user_ids?: string[]
          p_workspace_id: string
        }
        Returns: {
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      companies_op_create: {
        Args: {
          p_domains?: string[]
          p_name: string
          p_notes_inline?: string
          p_website?: string
          p_workspace_id: string
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          custom: Json
          deleted_at: string | null
          domains: string[]
          id: string
          name: string
          notes_inline: string
          owner_id: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      companies_op_delete: {
        Args: { p_company_id: string; p_workspace_id: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          custom: Json
          deleted_at: string | null
          domains: string[]
          id: string
          name: string
          notes_inline: string
          owner_id: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      companies_op_set_details: {
        Args: { p_company_id: string; p_patch: Json; p_workspace_id: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          custom: Json
          deleted_at: string | null
          domains: string[]
          id: string
          name: string
          notes_inline: string
          owner_id: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      companies_op_update: {
        Args: {
          p_company_id: string
          p_domains?: string[]
          p_name?: string
          p_notes_inline?: string
          p_website?: string
          p_workspace_id: string
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          custom: Json
          deleted_at: string | null
          domains: string[]
          id: string
          name: string
          notes_inline: string
          owner_id: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts__emails_to_jsonb: {
        Args: { p_arr: string[]; p_primary: string }
        Returns: Json
      }
      contacts__primary_value: { Args: { p_list: Json }; Returns: string }
      contacts_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      contacts_op__guard: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      contacts_op__guard_contact: {
        Args: { p_contact_id: string; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_add_field_def: {
        Args: {
          p_key: string
          p_label: string
          p_options?: Json
          p_position?: number
          p_type?: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          label: string
          options: Json
          position: number
          type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contact_field_defs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_create: {
        Args: {
          p_company_id?: string
          p_email?: string
          p_name: string
          p_notes_inline?: string
          p_phone?: string
          p_status?: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_delete: {
        Args: { p_contact_id: string; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_delete_field_def: {
        Args: { p_field_id: string; p_workspace_id: string }
        Returns: undefined
      }
      contacts_op_import: {
        Args: { p_rows: Json; p_workspace_id: string }
        Returns: Json
      }
      contacts_op_link: {
        Args: {
          p_contact_id: string
          p_contact_label?: string
          p_contact_type: string
          p_origin?: string
          p_relation_kind?: string
          p_target_icon?: string
          p_target_id: string
          p_target_label?: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_restore: {
        Args: { p_contact_id: string; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_set_details: {
        Args: { p_contact_id: string; p_patch: Json; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_set_favorite: {
        Args: { p_contact_id: string; p_value: boolean; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_set_status: {
        Args: { p_contact_id: string; p_status: string; p_workspace_id: string }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_unlink: {
        Args: { p_link_id: string; p_workspace_id: string }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contacts_op_update: {
        Args: {
          p_company_id?: string
          p_contact_id: string
          p_email?: string
          p_name?: string
          p_notes_inline?: string
          p_phone?: string
          p_set_company?: boolean
          p_title?: string
          p_workspace_id: string
        }
        Returns: {
          addresses: Json
          avatar_url: string | null
          company_id: string | null
          created_at: string
          custom: Json
          dates: Json
          deleted_at: string | null
          email: string | null
          emails: Json
          id: string
          is_favorite: boolean
          name: string
          notes_inline: string
          owner_id: string | null
          phone: string | null
          phones: Json
          status: string
          title: string | null
          updated_at: string
          urls: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      email_op__guard: { Args: { p_workspace_id: string }; Returns: undefined }
      email_op__guard_ref: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_account_remove: {
        Args: { p_account_id: string; p_workspace_id: string }
        Returns: {
          address: string
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          owner_id: string
          provider: string
          signature_html: string
          status: string
          unread_count: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_account_upsert: {
        Args: {
          p_address: string
          p_color?: string
          p_provider: string
          p_signature_html?: string
          p_status?: string
          p_unread_count?: number
          p_workspace_id: string
        }
        Returns: {
          address: string
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          owner_id: string
          provider: string
          signature_html: string
          status: string
          unread_count: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_clear_follow_up: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_follow_up: {
        Args: {
          p_follow_up_at: string
          p_ref_id: string
          p_workspace_id: string
        }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_follow_up_due: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_link: {
        Args: {
          p_origin?: string
          p_relation_kind?: string
          p_target_icon?: string
          p_target_id: string
          p_target_label?: string
          p_target_type: string
          p_thread_id: string
          p_thread_label?: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_ref_remove: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_ref_upsert: {
        Args: {
          p_account_id?: string
          p_from_addr?: string
          p_from_name?: string
          p_message_key?: string
          p_sent_at?: string
          p_snippet?: string
          p_subject?: string
          p_thread_key: string
          p_workspace_id: string
        }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_snooze: {
        Args: {
          p_ref_id: string
          p_snooze_until: string
          p_workspace_id: string
        }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_snooze_due: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_op_unsnooze: {
        Args: { p_ref_id: string; p_workspace_id: string }
        Returns: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          follow_up_at: string | null
          follow_up_cleared_at: string | null
          follow_up_notified_at: string | null
          from_addr: string | null
          from_name: string | null
          id: string
          is_snoozed: boolean
          message_key: string | null
          owner_id: string
          sent_at: string | null
          snippet: string
          snooze_until: string | null
          subject: string
          thread_key: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "email_refs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      entities_op_ensure: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_icon?: string
          p_label?: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      entities_op_tombstone: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      entities_op_upsert: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_icon?: string
          p_label?: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      links_op_create: {
        Args: {
          p_origin?: string
          p_relation_kind?: string
          p_source_icon?: string
          p_source_id: string
          p_source_label?: string
          p_source_type: string
          p_target_icon?: string
          p_target_id: string
          p_target_label?: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      links_op_decline_suggestion: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_target_id: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      links_op_delete: {
        Args: { p_link_id: string; p_workspace_id: string }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      links_op_set_kind: {
        Args: {
          p_link_id: string
          p_relation_kind: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          origin: string
          pair_key: string | null
          relation_kind: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "entity_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      links_suggest: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_limit?: number
          p_workspace_id: string
        }
        Returns: {
          other_icon: string
          other_id: string
          other_label: string
          other_type: string
          signal: string
          strength: number
          suggested_kind: string
        }[]
      }
      module_activity_log: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_module: string
          p_op: string
          p_payload: Json
          p_workspace_id: string
        }
        Returns: undefined
      }
      module_api_key_id: { Args: never; Returns: string }
      notes__purge_ids: {
        Args: { p_ids: string[]; p_workspace_id: string }
        Returns: number
      }
      notes__subtree_ids: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: string[]
      }
      notes_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      notes_op__guard: { Args: { p_workspace_id: string }; Returns: undefined }
      notes_op__guard_note: {
        Args: {
          p_include_trashed?: boolean
          p_note_id: string
          p_workspace_id: string
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_apply_updates: {
        Args: {
          p_body_md?: string
          p_body_text?: string
          p_client_id: string
          p_note_id: string
          p_updates: Json
          p_workspace_id: string
        }
        Returns: Json
      }
      notes_op_archive: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_create: {
        Args: {
          p_icon?: string
          p_id?: string
          p_parent_id?: string
          p_position?: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_duplicate: {
        Args: {
          p_position?: string
          p_source_note_id: string
          p_workspace_id: string
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_import: {
        Args: { p_rows: Json; p_workspace_id: string }
        Returns: Json
      }
      notes_op_mention: {
        Args: {
          p_mentioned_user_ids: string[]
          p_note_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      notes_op_move: {
        Args: {
          p_note_id: string
          p_parent_id?: string
          p_position?: string
          p_workspace_id: string
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_publish: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_purge: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: Json
      }
      notes_op_purge_expired: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      notes_op_rename: {
        Args: { p_note_id: string; p_title: string; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_restore: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: Json
      }
      notes_op_save_snapshot: {
        Args: {
          p_body_md?: string
          p_body_text?: string
          p_note_id: string
          p_snapshot_b64: string
          p_upto_update_id: number
          p_workspace_id: string
        }
        Returns: Json
      }
      notes_op_set_meta: {
        Args: { p_note_id: string; p_patch: Json; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_trash: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: Json
      }
      notes_op_unarchive: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_unpublish: {
        Args: { p_note_id: string; p_workspace_id: string }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          icon: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notifications_list: {
        Args: { p_limit?: number; p_workspace_id: string }
        Returns: {
          actor_id: string
          actor_label: string
          actor_type: string
          created_at: string
          dismissed_at: string
          entity_id: string
          entity_type: string
          id: string
          module: string
          op: string
          payload: Json
          read_at: string
          workspace_id: string
        }[]
      }
      notifications_op_dismiss: {
        Args: { p_activity_id: string; p_workspace_id: string }
        Returns: undefined
      }
      notifications_op_mark_all_read: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      notifications_op_mark_read: {
        Args: { p_activity_id: string; p_workspace_id: string }
        Returns: undefined
      }
      notifications_op_undismiss: {
        Args: { p_activity_id: string; p_workspace_id: string }
        Returns: undefined
      }
      profile_plan_tier_text: { Args: { p_user_id: string }; Returns: string }
      spine_activity_targets_me: {
        Args: {
          p_activity: Database["public"]["Tables"]["module_activity"]["Row"]
        }
        Returns: boolean
      }
      spine_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      spine_op__guard: { Args: { p_workspace_id: string }; Returns: undefined }
      spine_pair_key: {
        Args: { a_id: string; a_type: string; b_id: string; b_type: string }
        Returns: string
      }
      booking_google_connected: {
        Args: never
        Returns: boolean
      }
      tasks_module_can_access_workspace: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      tasks_module_permission: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      tasks_op__guard: {
        Args: { p_task_id: string; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_catch_up: {
        Args: { p_items: Json; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_commit: {
        Args: { p_for: string; p_task_id: string; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_reschedule: {
        Args: {
          p_days?: number
          p_scheduled_at: string
          p_task_id: string
          p_workspace_id: string
        }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_set_status: {
        Args: {
          p_position?: string
          p_recurrence?: Json
          p_status: string
          p_task_id: string
          p_workspace_id: string
        }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_skip_occurrence: {
        Args: {
          p_recurrence: Json
          p_release_commit?: boolean
          p_scheduled_at: string
          p_task_id: string
          p_workspace_id: string
        }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_skip_today: {
        Args: { p_task_id: string; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_uncommit: {
        Args: { p_task_id: string; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_unschedule: {
        Args: { p_task_id: string; p_workspace_id: string }
        Returns: {
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_date: string | null
          duration_minutes: number | null
          energy_level: string | null
          id: string
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          status: string
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_can_manage_workspace_members: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      user_is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      user_is_workspace_owner: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      waitlist_join: {
        Args: {
          p_email: string
          p_ip_hash: string
          p_referrer?: string
          p_source: string
          p_user_agent?: string
        }
        Returns: string
      }
      workspace_api_keys_can_manage: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      workspace_api_keys_create: {
        Args: { p_name: string; p_scopes?: Json; p_workspace_id: string }
        Returns: {
          created_at: string
          id: string
          key_prefix: string
          name: string
          scopes: Json
          secret: string
        }[]
      }
      workspace_api_keys_revoke: {
        Args: { p_key_id: string }
        Returns: undefined
      }
      workspace_api_keys_set_scopes: {
        Args: { p_key_id: string; p_scopes: Json }
        Returns: Json
      }
      workspace_op_accept_invite: {
        Args: { p_token: string }
        Returns: {
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
      }
      workspace_op_remove_member: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      workspace_op_set_member_role: {
        Args: {
          p_member_id: string
          p_perm_notes?: string
          p_perm_tasks?: string
          p_role: string
        }
        Returns: undefined
      }
      workspace_op_transfer_ownership: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      workspaces_owned_count_for_user: {
        Args: { p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      plan_tier: "free" | "pro" | "team" | "founder" | "duo"
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
      plan_tier: ["free", "pro", "team", "founder", "duo"],
    },
  },
} as const
