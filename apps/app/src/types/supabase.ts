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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      access_changes: {
        Row: {
          changed_at: string
          id: number
          resource_id: string
          resource_type: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          id?: never
          resource_id: string
          resource_type: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          id?: never
          resource_id?: string
          resource_type?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_changes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_session_summaries: {
        Row: {
          session_id: string
          summary: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          session_id: string
          summary: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          session_id?: string
          summary?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_session_summaries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_session_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_session_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_session_summaries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          agent: string
          created_at: string
          deleted_at: string | null
          earlier: Json
          id: string
          key_id: string | null
          links: Json
          note: string | null
          started_at: string
          state: string
          step: number | null
          steps: number | null
          stopped_at: string | null
          summary_at: string | null
          summary_posted_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          agent: string
          created_at?: string
          deleted_at?: string | null
          earlier?: Json
          id?: string
          key_id?: string | null
          links?: Json
          note?: string | null
          started_at?: string
          state: string
          step?: number | null
          steps?: number | null
          stopped_at?: string | null
          summary_at?: string | null
          summary_posted_at?: string | null
          task_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          deleted_at?: string | null
          earlier?: Json
          id?: string
          key_id?: string | null
          links?: Json
          note?: string | null
          started_at?: string
          state?: string
          step?: number | null
          steps?: number | null
          stopped_at?: string | null
          summary_at?: string | null
          summary_posted_at?: string | null
          task_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sessions_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "workspace_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      areas: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          position: number
          shared: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          position?: number
          shared?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          position?: number
          shared?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "areas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "areas_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "areas_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "areas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      areas_detached: {
        Row: {
          area_id: string
          created_at: string
          project_ids: string[]
        }
        Insert: {
          area_id: string
          created_at?: string
          project_ids?: string[]
        }
        Update: {
          area_id?: string
          created_at?: string
          project_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "areas_detached_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: true
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          deleted_reason: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height: number | null
          id: string
          mime: string
          object_path: string
          preview_bytes: number
          preview_mime: string | null
          preview_path: string | null
          size_bytes: number
          status: string
          updated_at: string
          uploader_id: string | null
          width: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_batch_id?: string | null
          deleted_reason?: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height?: number | null
          id?: string
          mime: string
          object_path: string
          preview_bytes?: number
          preview_mime?: string | null
          preview_path?: string | null
          size_bytes: number
          status?: string
          updated_at?: string
          uploader_id?: string | null
          width?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_batch_id?: string | null
          deleted_reason?: string | null
          entity_id?: string
          entity_type?: string
          file_name?: string
          height?: number | null
          id?: string
          mime?: string
          object_path?: string
          preview_bytes?: number
          preview_mime?: string | null
          preview_path?: string | null
          size_bytes?: number
          status?: string
          updated_at?: string
          uploader_id?: string | null
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_attempts: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip_hash: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: never
          ip_hash?: string
          owner_id?: string
        }
        Relationships: []
      }
      booking_link_hosts: {
        Row: {
          link_id: string
          status: string
          user_id: string
        }
        Insert: {
          link_id: string
          status?: string
          user_id: string
        }
        Update: {
          link_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_link_hosts_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "exposed_slot_links"
            referencedColumns: ["id"]
          },
        ]
      }
      buckets: {
        Row: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          area_id?: string | null
          client_company_id?: string | null
          client_contact_id?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_batch_id?: string | null
          description?: string
          group_label?: string | null
          id?: string
          is_system?: boolean
          lead_id?: string | null
          name: string
          owner_id?: string | null
          position?: string
          starts_on?: string | null
          status?: string
          target_on?: string | null
          trash_moved?: Json | null
          trash_moved_at?: string | null
          trash_moved_task_ids?: string[] | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          area_id?: string | null
          client_company_id?: string | null
          client_contact_id?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_batch_id?: string | null
          description?: string
          group_label?: string | null
          id?: string
          is_system?: boolean
          lead_id?: string | null
          name?: string
          owner_id?: string | null
          position?: string
          starts_on?: string | null
          status?: string
          target_on?: string | null
          trash_moved?: Json | null
          trash_moved_at?: string | null
          trash_moved_task_ids?: string[] | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buckets_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buckets_client_company_id_fkey"
            columns: ["client_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buckets_client_contact_id_fkey"
            columns: ["client_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buckets_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buckets_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
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
          calendar_ref: string | null
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
          calendar_ref?: string | null
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
          calendar_ref?: string | null
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
            foreignKeyName: "calendar_events_calendar_ref_fkey"
            columns: ["calendar_ref"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
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
      calendar_set_items: {
        Row: {
          calendar_id: string
          set_id: string
        }
        Insert: {
          calendar_id: string
          set_id: string
        }
        Update: {
          calendar_id?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_set_items_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_set_items_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "calendar_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sets: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendars: {
        Row: {
          account_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          name: string
          owner_id: string
          publish_level: string | null
          publish_token: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          name?: string
          owner_id: string
          publish_level?: string | null
          publish_token?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          publish_level?: string | null
          publish_token?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendars_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "calendar_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_catchup: {
        Row: {
          activity_id: string | null
          actor_id: string | null
          chain_root_id: string | null
          channel_id: string
          channel_name: string | null
          created_at: string
          done_at: string | null
          done_how: string | null
          emailed_at: string | null
          held_at: string | null
          id: string
          later_notified_at: string | null
          later_until: string | null
          message_id: string | null
          reason: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          actor_id?: string | null
          chain_root_id?: string | null
          channel_id: string
          channel_name?: string | null
          created_at?: string
          done_at?: string | null
          done_how?: string | null
          emailed_at?: string | null
          held_at?: string | null
          id?: string
          later_notified_at?: string | null
          later_until?: string | null
          message_id?: string | null
          reason: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          activity_id?: string | null
          actor_id?: string | null
          chain_root_id?: string | null
          channel_id?: string
          channel_name?: string | null
          created_at?: string
          done_at?: string | null
          done_how?: string | null
          emailed_at?: string | null
          held_at?: string | null
          id?: string
          later_notified_at?: string | null
          later_until?: string | null
          message_id?: string | null
          reason?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_catchup_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "module_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_catchup_chain_root_id_fkey"
            columns: ["chain_root_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_catchup_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_catchup_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_chain_mutes: {
        Row: {
          created_at: string
          root_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          root_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          root_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_chain_mutes_root_id_fkey"
            columns: ["root_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_chain_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_chain_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_chain_mutes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_managers: {
        Row: {
          channel_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_managers_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dm_key?: string | null
          id?: string
          is_default?: boolean
          is_private?: boolean
          kind: string
          last_message_at?: string | null
          linked_at?: string | null
          linked_id?: string | null
          linked_type?: string | null
          managers_only?: boolean
          name?: string | null
          purged_at?: string | null
          roster_at?: string | null
          topic?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dm_key?: string | null
          id?: string
          is_default?: boolean
          is_private?: boolean
          kind?: string
          last_message_at?: string | null
          linked_at?: string | null
          linked_id?: string | null
          linked_type?: string | null
          managers_only?: boolean
          name?: string | null
          purged_at?: string | null
          roster_at?: string | null
          topic?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_custom_emoji: {
        Row: {
          animated: boolean
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number
          id: string
          mime: string
          name: string
          poster_path: string
          storage_path: string
          updated_at: string
          width: number
          workspace_id: string
        }
        Insert: {
          animated?: boolean
          bytes: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          height: number
          id?: string
          mime: string
          name: string
          poster_path: string
          storage_path: string
          updated_at?: string
          width: number
          workspace_id: string
        }
        Update: {
          animated?: boolean
          bytes?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          height?: number
          id?: string
          mime?: string
          name?: string
          poster_path?: string
          storage_path?: string
          updated_at?: string
          width?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_custom_emoji_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_custom_emoji_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_custom_emoji_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_custom_emoji_uploads: {
        Row: {
          created_at: string
          id: string
          uploader_id: string
          used_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          uploader_id: string
          used_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          uploader_id?: string
          used_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_custom_emoji_uploads_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_custom_emoji_uploads_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_custom_emoji_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          access_at: string | null
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          last_read_id: string | null
          left_at: string | null
          notify_level: string
          removed_at: string | null
          removed_by: string | null
          starred: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          access_at?: string | null
          channel_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          last_read_id?: string | null
          left_at?: string | null
          notify_level?: string
          removed_at?: string | null
          removed_by?: string | null
          starred?: boolean
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          access_at?: string | null
          channel_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          last_read_id?: string | null
          left_at?: string | null
          notify_level?: string
          removed_at?: string | null
          removed_by?: string | null
          starred?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_last_read_id_fkey"
            columns: ["last_read_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        Insert: {
          api_key_id?: string | null
          author_id?: string | null
          author_kind?: string
          author_label?: string | null
          body?: string
          body_text?: string
          channel_id: string
          client_id?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          event?: Json | null
          file_count?: number
          format_version?: number
          id?: string
          kind?: string
          last_reply_at?: string | null
          mentioned_team_ids?: string[]
          mentioned_user_ids?: string[]
          mentions_everyone?: boolean
          moved_at?: string | null
          moved_by?: string | null
          moved_from_channel_id?: string | null
          parent_id?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          reactions?: Json
          reopened_at?: string | null
          reopened_by?: string | null
          reply_count?: number
          reply_to_id?: string | null
          reply_user_ids?: string[]
          search_tsv?: unknown
          settled_id?: string | null
          updated_at?: string
          v1_thread_reply?: boolean
          workspace_id: string
          wrapped_at?: string | null
          wrapped_by?: string | null
        }
        Update: {
          api_key_id?: string | null
          author_id?: string | null
          author_kind?: string
          author_label?: string | null
          body?: string
          body_text?: string
          channel_id?: string
          client_id?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          event?: Json | null
          file_count?: number
          format_version?: number
          id?: string
          kind?: string
          last_reply_at?: string | null
          mentioned_team_ids?: string[]
          mentioned_user_ids?: string[]
          mentions_everyone?: boolean
          moved_at?: string | null
          moved_by?: string | null
          moved_from_channel_id?: string | null
          parent_id?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          reactions?: Json
          reopened_at?: string | null
          reopened_by?: string | null
          reply_count?: number
          reply_to_id?: string | null
          reply_user_ids?: string[]
          search_tsv?: unknown
          settled_id?: string | null
          updated_at?: string
          v1_thread_reply?: boolean
          workspace_id?: string
          wrapped_at?: string | null
          wrapped_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "workspace_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_moved_from_channel_id_fkey"
            columns: ["moved_from_channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_settled_id_fkey"
            columns: ["settled_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_typing_marks: {
        Row: {
          channel_id: string
          open: boolean
          parent_id: string | null
          sent_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          open?: boolean
          parent_id?: string | null
          sent_at: string
          user_id: string
        }
        Update: {
          channel_id?: string
          open?: boolean
          parent_id?: string | null
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_typing_marks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          reaction: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          reaction: string
          user_id: string
          workspace_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          reaction?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "comment_reactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          anchor_id?: string | null
          author_kind?: string
          author_label?: string | null
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          edited_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          resolved_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          anchor_id?: string | null
          author_kind?: string
          author_label?: string | null
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          edited_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          resolved_at?: string | null
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
      contact_group_members: {
        Row: {
          contact_id: string
          group_id: string
        }
        Insert: {
          contact_id: string
          group_id: string
        }
        Update: {
          contact_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_group_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_groups: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_private_notes: {
        Row: {
          body: string
          contact_id: string
          user_id: string
        }
        Insert: {
          body?: string
          contact_id: string
          user_id: string
        }
        Update: {
          body?: string
          contact_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_private_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
          origin: string
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
          origin?: string
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
          origin?: string
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
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          id: string
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          locked_until: string | null
          payload: Json
          provider_id: string | null
          send_after: string
          sent_at: string | null
          status: string
          stream: string
          to_email: string
          to_user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          id?: string
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          provider_id?: string | null
          send_after?: string
          sent_at?: string | null
          status?: string
          stream?: string
          to_email: string
          to_user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          id?: string
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          provider_id?: string | null
          send_after?: string
          sent_at?: string | null
          status?: string
          stream?: string
          to_email?: string
          to_user_id?: string | null
        }
        Relationships: []
      }
      email_outbox_runner: {
        Row: {
          id: boolean
          locked_until: string
          token: string
        }
        Insert: {
          id?: boolean
          locked_until: string
          token: string
        }
        Update: {
          id?: boolean
          locked_until?: string
          token?: string
        }
        Relationships: []
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
      email_subscriptions: {
        Row: {
          confirmed_at: string | null
          email: string
          requested_at: string
          source: string
          status: string
          topic: string
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          confirmed_at?: string | null
          email: string
          requested_at?: string
          source: string
          status?: string
          topic?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          confirmed_at?: string | null
          email?: string
          requested_at?: string
          source?: string
          status?: string
          topic?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          provider_event_id: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          provider_event_id?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          provider_event_id?: string | null
          reason?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string
          deleted_at: string | null
          entity_id: string
          entity_type: string
          handle: string | null
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
          handle?: string | null
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
          handle?: string | null
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
          collective: boolean
          conflict_calendars: string
          created_at: string
          date_range_days: number
          deleted_at: string | null
          description: string
          duration_minutes: number
          guest_reminder_minutes: number | null
          guests_enabled: boolean
          host_timezone: string
          id: string
          link_name: string
          location_type: string
          min_notice_minutes: number
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
          collective?: boolean
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          deleted_at?: string | null
          description?: string
          duration_minutes?: number
          guest_reminder_minutes?: number | null
          guests_enabled?: boolean
          host_timezone?: string
          id?: string
          link_name?: string
          location_type?: string
          min_notice_minutes?: number
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
          collective?: boolean
          conflict_calendars?: string
          created_at?: string
          date_range_days?: number
          deleted_at?: string | null
          description?: string
          duration_minutes?: number
          guest_reminder_minutes?: number | null
          guests_enabled?: boolean
          host_timezone?: string
          id?: string
          link_name?: string
          location_type?: string
          min_notice_minutes?: number
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
      focus_runs: {
        Row: {
          blocks_completed: number
          control_at: string
          created_at: string
          device_id: string
          done_task_ids: string[]
          ended_at: string | null
          focused_seconds: number
          id: string
          mode: string
          now_task_id: string | null
          paused_at: string | null
          phase: string
          phase_seconds: number | null
          phase_started_at: string
          seen_at: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          blocks_completed?: number
          control_at?: string
          created_at?: string
          device_id: string
          done_task_ids?: string[]
          ended_at?: string | null
          focused_seconds?: number
          id?: string
          mode?: string
          now_task_id?: string | null
          paused_at?: string | null
          phase?: string
          phase_seconds?: number | null
          phase_started_at?: string
          seen_at?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          blocks_completed?: number
          control_at?: string
          created_at?: string
          device_id?: string
          done_task_ids?: string[]
          ended_at?: string | null
          focused_seconds?: number
          id?: string
          mode?: string
          now_task_id?: string | null
          paused_at?: string | null
          phase?: string
          phase_seconds?: number | null
          phase_started_at?: string
          seen_at?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_runs_now_task_id_fkey"
            columns: ["now_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "focus_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_emails: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
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
      import_rows: {
        Row: {
          action: string
          entity_id: string
          entity_type: string
          id: string
          import_id: string
          logged_at: string
          workspace_id: string
        }
        Insert: {
          action: string
          entity_id: string
          entity_type: string
          id?: string
          import_id: string
          logged_at?: string
          workspace_id: string
        }
        Update: {
          action?: string
          entity_id?: string
          entity_type?: string
          id?: string
          import_id?: string
          logged_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          finished_at: string | null
          id: string
          key_id: string | null
          label: string | null
          source: string
          started_at: string
          undone_at: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          key_id?: string | null
          label?: string | null
          source: string
          started_at?: string
          undone_at?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          key_id?: string | null
          label?: string | null
          source?: string
          started_at?: string
          undone_at?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "workspace_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "imports_workspace_id_fkey"
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
      note_favorites: {
        Row: {
          created_at: string
          note_id: string
          position: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          note_id: string
          position?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          note_id?: string
          position?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_favorites_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_favorites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_live_pending: {
        Row: {
          note_id: string
          tx: number
        }
        Insert: {
          note_id: string
          tx?: number
        }
        Update: {
          note_id?: string
          tx?: number
        }
        Relationships: []
      }
      note_live_viewers: {
        Row: {
          note_id: string
          seen_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          note_id: string
          seen_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          note_id?: string
          seen_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_live_viewers_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
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
          actor_key_id: string | null
          client_id: string
          client_seq: number
          created_at: string
          id: number
          note_id: string
          origin: string
          update_b64: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_key_id?: string | null
          client_id: string
          client_seq: number
          created_at?: string
          id?: never
          note_id: string
          origin?: string
          update_b64: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_key_id?: string | null
          client_id?: string
          client_seq?: number
          created_at?: string
          id?: never
          note_id?: string
          origin?: string
          update_b64?: string
          user_id?: string | null
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
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        Insert: {
          body_md?: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          doc_version?: number
          edited_at?: string | null
          edited_by?: string | null
          full_width?: boolean
          icon?: string | null
          id?: string
          in_inbox: boolean
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          publish_token?: string | null
          published_at?: string | null
          search_tsv?: unknown
          share_mode?: string
          share_permission?: string
          share_scope?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id: string
          workspace_shared?: boolean
        }
        Update: {
          body_md?: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc_state?: string | null
          doc_version?: number
          edited_at?: string | null
          edited_by?: string | null
          full_width?: boolean
          icon?: string | null
          id?: string
          in_inbox?: boolean
          is_archived?: boolean
          is_pinned?: boolean
          kind?: string
          parent_id?: string | null
          position?: string
          publish_token?: string | null
          published_at?: string | null
          search_tsv?: unknown
          share_mode?: string
          share_permission?: string
          share_scope?: string
          tags?: Json
          title?: string
          updated_at?: string
          workspace_id?: string
          workspace_shared?: boolean
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
      notice_deliveries: {
        Row: {
          acked_at: string | null
          body: string | null
          channel_id: string | null
          created_at: string
          held_for_focus: boolean
          id: string
          kind: string
          message_id: string | null
          push_after: string | null
          push_attempts: number
          push_claimed_at: string | null
          push_error: string | null
          pushed_at: string | null
          tag: string | null
          task_id: string | null
          title: string
          url: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          acked_at?: string | null
          body?: string | null
          channel_id?: string | null
          created_at?: string
          held_for_focus?: boolean
          id?: string
          kind: string
          message_id?: string | null
          push_after?: string | null
          push_attempts?: number
          push_claimed_at?: string | null
          push_error?: string | null
          pushed_at?: string | null
          tag?: string | null
          task_id?: string | null
          title: string
          url?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          acked_at?: string | null
          body?: string | null
          channel_id?: string | null
          created_at?: string
          held_for_focus?: boolean
          id?: string
          kind?: string
          message_id?: string | null
          push_after?: string | null
          push_attempts?: number
          push_claimed_at?: string | null
          push_error?: string | null
          pushed_at?: string | null
          tag?: string | null
          task_id?: string | null
          title?: string
          url?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notice_deliveries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notice_deliveries_workspace_id_fkey"
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_period_end: string | null
          display_name: string
          id: string
          plan_tier: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string
          id: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string
          id?: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          plan_updated_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_statuses: {
        Row: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category: string
          created_at?: string
          deleted_at?: string | null
          hidden?: boolean
          id?: string
          name: string
          position?: number
          project_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          hidden?: boolean
          id?: string
          name?: string
          position?: number
          project_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_statuses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          body: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          private_source: boolean
          shareable: boolean
          shared: boolean
          source_ids: string[]
          summary: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_id: string
          private_source?: boolean
          shareable?: boolean
          shared?: boolean
          source_ids?: string[]
          summary?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          private_source?: boolean
          shareable?: boolean
          shared?: boolean
          source_ids?: string[]
          summary?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "project_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failures: number
          id: string
          last_used_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failures?: number
          id?: string
          last_used_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failures?: number
          id?: string
          last_used_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
      resource_grants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          level: string
          manual_level: string | null
          origin: string
          resource_id: string
          resource_type: string
          subject_id: string | null
          subject_key: string | null
          subject_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          level: string
          manual_level?: string | null
          origin?: string
          resource_id: string
          resource_type: string
          subject_id?: string | null
          subject_key?: string | null
          subject_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string
          manual_level?: string | null
          origin?: string
          resource_id?: string
          resource_type?: string
          subject_id?: string | null
          subject_key?: string | null
          subject_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          name: string
          position?: number
          project_id: string
          starts_on?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
          starts_on?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
          email_context: Json | null
          end_at: string
          guest_emails: Json
          host_cancelled_at: string | null
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
          email_context?: Json | null
          end_at: string
          guest_emails?: Json
          host_cancelled_at?: string | null
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
          email_context?: Json | null
          end_at?: string
          guest_emails?: Json
          host_cancelled_at?: string | null
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
      storage_usage: {
        Row: {
          bytes_used: number
          last_alert_level: number
          owner_id: string
          updated_at: string
        }
        Insert: {
          bytes_used?: number
          last_alert_level?: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          bytes_used?: number
          last_alert_level?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_usage_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_usage_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sync_tombstones: {
        Row: {
          deleted_at: string
          row_id: string
          table_name: string
          workspace_id: string
        }
        Insert: {
          deleted_at?: string
          row_id: string
          table_name: string
          workspace_id: string
        }
        Update: {
          deleted_at?: string
          row_id?: string
          table_name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_tombstones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_links: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          tag_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          tag_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          tag_id?: string
          updated_at?: string
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
      task_completions: {
        Row: {
          completed_at: string
          cycle_key: string
          deleted_at: string | null
          id: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string
          cycle_key: string
          deleted_at?: string | null
          id?: string
          task_id: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string
          cycle_key?: string
          deleted_at?: string | null
          id?: string
          task_id?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_completions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_queue: {
        Row: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          position: string
          queued_at?: string
          task_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          position?: string
          queued_at?: string
          task_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_queue_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_queue_workspace_id_fkey"
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
          updated_at: string
          workspace_id: string
        }
        Insert: {
          blocked_task_id: string
          blocker_task_id: string
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          blocked_task_id?: string
          blocker_task_id?: string
          created_at?: string
          id?: string
          updated_at?: string
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
            foreignKeyName: "task_relations_blocker_task_id_fkey"
            columns: ["blocker_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
      task_reminders: {
        Row: {
          at: string | null
          created_at: string
          deleted_at: string | null
          fired_at: string | null
          id: string
          kind: string
          suspended_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          at?: string | null
          created_at?: string
          deleted_at?: string | null
          fired_at?: string | null
          id?: string
          kind: string
          suspended_at?: string | null
          task_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          at?: string | null
          created_at?: string
          deleted_at?: string | null
          fired_at?: string | null
          id?: string
          kind?: string
          suspended_at?: string | null
          task_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_reminders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_sessions: {
        Row: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          ends_at: string
          id?: string
          starts_at: string
          task_id: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          ends_at?: string
          id?: string
          starts_at?: string
          task_id?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          body: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          private_source: boolean
          shareable: boolean
          shared: boolean
          source_ids: string[]
          summary: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          owner_id: string
          private_source?: boolean
          shareable?: boolean
          shared?: boolean
          source_ids?: string[]
          summary?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          private_source?: boolean
          shareable?: boolean
          shared?: boolean
          source_ids?: string[]
          summary?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_templates_workspace_id_fkey"
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
      task_time_entries: {
        Row: {
          client_key: string | null
          created_at: string
          ended_at: string | null
          entry_on: string | null
          id: string
          kind: string
          note: string | null
          reason: string | null
          run_id: string | null
          seconds: number
          started_at: string | null
          task_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          client_key?: string | null
          created_at?: string
          ended_at?: string | null
          entry_on?: string | null
          id?: string
          kind: string
          note?: string | null
          reason?: string | null
          run_id?: string | null
          seconds: number
          started_at?: string | null
          task_id: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          client_key?: string | null
          created_at?: string
          ended_at?: string | null
          entry_on?: string | null
          id?: string
          kind?: string
          note?: string | null
          reason?: string | null
          run_id?: string | null
          seconds?: number
          started_at?: string | null
          task_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "focus_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_views: {
        Row: {
          created_at: string
          deleted_at: string | null
          display: Json
          filters: Json
          id: string
          name: string
          owner_id: string
          position: number
          project_id: string | null
          scope: string
          seed: string | null
          shared: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display?: Json
          filters?: Json
          id?: string
          name: string
          owner_id: string
          position?: number
          project_id?: string | null
          scope: string
          seed?: string | null
          shared?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display?: Json
          filters?: Json
          id?: string
          name?: string
          owner_id?: string
          position?: number
          project_id?: string | null
          scope?: string
          seed?: string | null
          shared?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_waiting: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          label: string | null
          ref: string | null
          since: string
          task_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind: string
          label?: string | null
          ref?: string | null
          since?: string
          task_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          label?: string | null
          ref?: string | null
          since?: string
          task_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_waiting_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_waiting_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_waiting_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_waiting_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
          time_spent_seconds: number
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          bucket_id: string
          commit_order?: number | null
          committed_for?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          creator_unknown?: boolean
          deleted_at?: string | null
          deleted_batch_id?: string | null
          description?: string
          due_date?: string | null
          due_on?: string | null
          due_time?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          estimate_minutes?: number | null
          id?: string
          imported_from?: Json | null
          number: number
          owner_id?: string | null
          parent_id?: string | null
          position?: string
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number
          scheduled_at?: string | null
          section_id?: string | null
          status?: string
          status_category: string
          status_id: string
          team_check_back_at?: string | null
          team_id?: string | null
          team_routed_at?: string | null
          time_spent_seconds?: number
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          bucket_id?: string
          commit_order?: number | null
          committed_for?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          creator_unknown?: boolean
          deleted_at?: string | null
          deleted_batch_id?: string | null
          description?: string
          due_date?: string | null
          due_on?: string | null
          due_time?: string | null
          duration_minutes?: number | null
          energy_level?: string | null
          estimate_minutes?: number | null
          id?: string
          imported_from?: Json | null
          number?: number
          owner_id?: string | null
          parent_id?: string | null
          position?: string
          priority?: string | null
          recurrence?: Json | null
          reschedule_count?: number
          scheduled_at?: string | null
          section_id?: string | null
          status?: string
          status_category?: string
          status_id?: string
          team_check_back_at?: string | null
          team_id?: string | null
          team_routed_at?: string | null
          time_spent_seconds?: number
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "project_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
      team_members: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          team_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          team_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          team_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "team_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          default_project_id: string | null
          deleted_at: string | null
          id: string
          mark: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_project_id?: string | null
          deleted_at?: string | null
          id?: string
          mark: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_project_id?: string | null
          deleted_at?: string | null
          id?: string
          mark?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "teams_default_project_id_fkey"
            columns: ["default_project_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_clients: {
        Row: {
          created_at: string
          id: string
          last_active_at: string | null
          last_seen_at: string
          surface: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          last_active_at?: string | null
          last_seen_at?: string
          surface: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_active_at?: string | null
          last_seen_at?: string
          surface?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
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
        }
        Relationships: []
      }
      user_notice_pauses: {
        Row: {
          paused_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          paused_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          paused_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notice_pauses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notice_pauses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_notice_pauses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          appearance: Json
          appearance_updated_at: string
          calendar: Json
          calendar_updated_at: string
          created_at: string
          date_order: string | null
          email: Json
          email_updated_at: string
          email_when_away: boolean
          focus: Json
          focus_updated_at: string
          hour_cycle: string | null
          notice_show_text: boolean
          preferences: Json
          preferences_updated_at: string
          quiet_from: string | null
          quiet_hours_on: boolean
          quiet_to: string | null
          reaction_row: string[] | null
          share_time_with_owner: boolean
          show_agent_work: boolean
          show_focus_task: boolean
          show_online: boolean
          task_time_blocks: Json
          time_zone: string | null
          time_zone_manual: boolean
          user_id: string
          week_start: number | null
        }
        Insert: {
          appearance?: Json
          appearance_updated_at?: string
          calendar?: Json
          calendar_updated_at?: string
          created_at?: string
          date_order?: string | null
          email?: Json
          email_updated_at?: string
          email_when_away?: boolean
          focus?: Json
          focus_updated_at?: string
          hour_cycle?: string | null
          notice_show_text?: boolean
          preferences?: Json
          preferences_updated_at?: string
          quiet_from?: string | null
          quiet_hours_on?: boolean
          quiet_to?: string | null
          reaction_row?: string[] | null
          share_time_with_owner?: boolean
          show_agent_work?: boolean
          show_focus_task?: boolean
          show_online?: boolean
          task_time_blocks?: Json
          time_zone?: string | null
          time_zone_manual?: boolean
          user_id: string
          week_start?: number | null
        }
        Update: {
          appearance?: Json
          appearance_updated_at?: string
          calendar?: Json
          calendar_updated_at?: string
          created_at?: string
          date_order?: string | null
          email?: Json
          email_updated_at?: string
          email_when_away?: boolean
          focus?: Json
          focus_updated_at?: string
          hour_cycle?: string | null
          notice_show_text?: boolean
          preferences?: Json
          preferences_updated_at?: string
          quiet_from?: string | null
          quiet_hours_on?: boolean
          quiet_to?: string | null
          reaction_row?: string[] | null
          share_time_with_owner?: boolean
          show_agent_work?: boolean
          show_focus_task?: boolean
          show_online?: boolean
          task_time_blocks?: Json
          time_zone?: string | null
          time_zone_manual?: boolean
          user_id?: string
          week_start?: number | null
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
      user_saved_statuses: {
        Row: {
          clear_after: string
          created_at: string
          dnd: boolean
          emoji: string | null
          id: string
          position: number
          text: string | null
          user_id: string
        }
        Insert: {
          clear_after?: string
          created_at?: string
          dnd?: boolean
          emoji?: string | null
          id?: string
          position?: number
          text?: string | null
          user_id: string
        }
        Update: {
          clear_after?: string
          created_at?: string
          dnd?: boolean
          emoji?: string | null
          id?: string
          position?: number
          text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_statuses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_saved_statuses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_status_changes: {
        Row: {
          n: number
          user_id: string
          window_start: string
        }
        Insert: {
          n: number
          user_id: string
          window_start: string
        }
        Update: {
          n?: number
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_status_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_status_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_entitlements"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_statuses: {
        Row: {
          clear_at: string | null
          dnd: boolean
          emoji: string | null
          id: string
          preset: string | null
          set_at: string | null
          text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          clear_at?: string | null
          dnd?: boolean
          emoji?: string | null
          id?: string
          preset?: string | null
          set_at?: string | null
          text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          clear_at?: string | null
          dnd?: boolean
          emoji?: string | null
          id?: string
          preset?: string | null
          set_at?: string | null
          text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_statuses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_statuses_user_id_fkey"
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
          invited_at: string | null
          ip_hash: string | null
          referrer: string | null
          source: string | null
          status: string
          updated_at: string
          updates_requested: boolean
          updates_requested_at: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_at?: string | null
          ip_hash?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          updates_requested?: boolean
          updates_requested_at?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_at?: string | null
          ip_hash?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          updates_requested?: boolean
          updates_requested_at?: string | null
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
          expires_at: string | null
          id: string
          include_private_chat: boolean
          key_hash: string | null
          key_prefix: string | null
          last_used_at: string | null
          name: string
          oauth_client_domain: string | null
          oauth_client_id: string | null
          oauth_client_scheme: string | null
          revoked_at: string | null
          scopes: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          include_private_chat?: boolean
          key_hash?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          name: string
          oauth_client_domain?: string | null
          oauth_client_id?: string | null
          oauth_client_scheme?: string | null
          revoked_at?: string | null
          scopes?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          include_private_chat?: boolean
          key_hash?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          name?: string
          oauth_client_domain?: string | null
          oauth_client_id?: string | null
          oauth_client_scheme?: string | null
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
      workspace_chat_caps: {
        Row: {
          add_emoji: boolean
          create_private: boolean
          create_public: boolean
          delete_others: boolean
          manage_any: boolean
          mention_everyone: boolean
          post: boolean
          role_key: string
          start_calls: boolean
          workspace_id: string
        }
        Insert: {
          add_emoji?: boolean
          create_private?: boolean
          create_public?: boolean
          delete_others?: boolean
          manage_any?: boolean
          mention_everyone?: boolean
          post?: boolean
          role_key: string
          start_calls?: boolean
          workspace_id: string
        }
        Update: {
          add_emoji?: boolean
          create_private?: boolean
          create_public?: boolean
          delete_others?: boolean
          manage_any?: boolean
          mention_everyone?: boolean
          post?: boolean
          role_key?: string
          start_calls?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_chat_caps_workspace_id_fkey"
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
          role_id: string | null
          share_payload: Json
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
          role_id?: string | null
          share_payload?: Json
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
          role_id?: string | null
          share_payload?: Json
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
            foreignKeyName: "workspace_invites_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "workspace_roles"
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
          overrides: Json
          permissions_email: string | null
          permissions_notes: string
          permissions_tasks: string
          perms: string[]
          role: string
          role_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          overrides?: Json
          permissions_email?: string | null
          permissions_notes?: string
          permissions_tasks?: string
          perms?: string[]
          role?: string
          role_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          overrides?: Json
          permissions_email?: string | null
          permissions_notes?: string
          permissions_tasks?: string
          perms?: string[]
          role?: string
          role_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "workspace_roles"
            referencedColumns: ["id"]
          },
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
      workspace_roles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          name: string
          permissions: string[]
          position: number
          read_only: boolean
          system_key: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name: string
          permissions?: string[]
          position?: number
          read_only?: boolean
          system_key?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name?: string
          permissions?: string[]
          position?: number
          read_only?: boolean
          system_key?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_share_defaults: {
        Row: {
          buckets: string
          calendars: string
          contacts: string
          notes: string
          workspace_id: string
        }
        Insert: {
          buckets?: string
          calendars?: string
          contacts?: string
          notes?: string
          workspace_id: string
        }
        Update: {
          buckets?: string
          calendars?: string
          contacts?: string
          notes?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_share_defaults_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
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
          task_key: string
          task_key_aliases: string[]
          task_number_last: number
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
          task_key: string
          task_key_aliases?: string[]
          task_number_last?: number
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
          task_key?: string
          task_key_aliases?: string[]
          task_number_last?: number
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
      user_entitlements: {
        Row: {
          current_period_end: string | null
          has_access: boolean | null
          plan_tier: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_days_remaining: number | null
          trial_ends_at: string | null
          user_id: string | null
        }
        Insert: {
          current_period_end?: string | null
          has_access?: never
          plan_tier?: never
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_days_remaining?: never
          trial_ends_at?: never
          user_id?: string | null
        }
        Update: {
          current_period_end?: string | null
          has_access?: never
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
      access_changes__note: {
        Args: {
          p_resource_id: string | null
          p_resource_type: string | null
          p_user_id: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      account_erase_workspace_data: {
        Args: { p_preview?: boolean | null; p_user: string | null }
        Returns: Json
      }
      account_erasure_inbox: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: string
      }
      account_erasure_new_owner: {
        Args: {
          p_id: string | null
          p_type: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      account_erasure_only_creator: {
        Args: { p_id: string | null; p_type: string | null; p_user: string | null }
        Returns: boolean
      }
      account_erasure_rank: {
        Args: { p_id: string | null; p_type: string | null; p_user: string | null }
        Returns: number
      }
      account_scrub_stripe_mirror: {
        Args: { p_customer_ids?: string[] | null; p_preview?: boolean | null; p_user: string | null }
        Returns: Json
      }
      agent_sessions__links: { Args: { p_links: Json | null }; Returns: Json }
      agent_sessions__shown: {
        Args: { p_owner: string | null; p_task_id: string | null }
        Returns: boolean
      }
      agent_sessions__shown_to: {
        Args: { p_owner: string | null; p_task_id: string | null; p_viewer: string | null }
        Returns: boolean
      }
      areas__check_color: { Args: { p_color: Json | null }; Returns: string }
      areas__check_name: {
        Args: { p_except: string | null; p_name: string | null; p_workspace_id: string | null }
        Returns: string
      }
      areas__find_or_create: {
        Args: { p_name: string | null; p_workspace_id: string | null }
        Returns: string
      }
      areas__list: {
        Args: { p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          position: number
          shared: boolean
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "areas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      areas__order: { Args: { p_workspace_id: string | null }; Returns: string[] }
      areas__visible: { Args: { p_area_id: string | null }; Returns: boolean }
      areas__visible_to: {
        Args: { p_area_id: string | null; p_user: string | null }
        Returns: boolean
      }
      areas_op_create: {
        Args: { p_color?: string | null; p_name: string | null; p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          position: number
          shared: boolean
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "areas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      areas_op_move: {
        Args: { p_after: string | null; p_area_id: string | null; p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          position: number
          shared: boolean
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "areas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      areas_op_update: {
        Args: { p_area_id: string | null; p_patch: Json | null; p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          position: number
          shared: boolean
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "areas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      attachments__alert: {
        Args: { p_owner: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      attachments__bytes: {
        Args: {
          p_deleted_at: string | null
          p_preview: number | null
          p_size: number | null
          p_status: string | null
        }
        Returns: number
      }
      attachments__chat_file_cap: { Args: never; Returns: number }
      attachments__orphan_objects: {
        Args: { p_limit?: number | null }
        Returns: {
          name: string
        }[]
      }
      attachments__platform_file_cap: { Args: never; Returns: number }
      attachments__preview_cap: { Args: never; Returns: number }
      attachments__purge_candidates: {
        Args: { p_limit?: number | null }
        Returns: {
          id: string
          object_path: string
          preview_path: string
          reason: string
        }[]
      }
      attachments__purge_rows: { Args: { p_ids: string[] | null }; Returns: number }
      attachments_largest: {
        Args: { p_limit?: number | null; p_workspace_id: string | null }
        Returns: {
          can_delete: boolean
          created_at: string
          file_name: string
          id: string
          mime: string
          size_bytes: number
          task_id: string
          task_title: string
          uploader_id: string
        }[]
      }
      attachments_op_abandon: { Args: { p_id: string | null }; Returns: string }
      attachments_op_begin: {
        Args: {
          p_channel_id?: string | null
          p_entity_id: string | null
          p_entity_type: string | null
          p_file_name: string | null
          p_height?: number | null
          p_mime: string | null
          p_preview_mime?: string | null
          p_size_bytes: number | null
          p_width?: number | null
          p_workspace_id: string | null
        }
        Returns: {
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          deleted_reason: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height: number | null
          id: string
          mime: string
          object_path: string
          preview_bytes: number
          preview_mime: string | null
          preview_path: string | null
          size_bytes: number
          status: string
          updated_at: string
          uploader_id: string | null
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attachments_op_delete: {
        Args: { p_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          deleted_reason: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height: number | null
          id: string
          mime: string
          object_path: string
          preview_bytes: number
          preview_mime: string | null
          preview_path: string | null
          size_bytes: number
          status: string
          updated_at: string
          uploader_id: string | null
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attachments_op_finalize: {
        Args: { p_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          deleted_reason: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height: number | null
          id: string
          mime: string
          object_path: string
          preview_bytes: number
          preview_mime: string | null
          preview_path: string | null
          size_bytes: number
          status: string
          updated_at: string
          uploader_id: string | null
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attachments_op_restore: {
        Args: { p_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          deleted_reason: string | null
          entity_id: string
          entity_type: string
          file_name: string
          height: number | null
          id: string
          mime: string
          object_path: string
          preview_bytes: number
          preview_mime: string | null
          preview_path: string | null
          size_bytes: number
          status: string
          updated_at: string
          uploader_id: string | null
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      booking__follow_event: {
        Args: { p_booking_id: string | null; p_event_id: string | null }
        Returns: undefined
      }
      booking__iso: { Args: { p_at: string | null }; Returns: string }
      booking__queue_host_cancel: {
        Args: { p_booking_id: string | null }
        Returns: number
      }
      booking__queue_reminders: {
        Args: { p_booking_id: string | null }
        Returns: number
      }
      booking__recipients: {
        Args: { b: Database["public"]["Tables"]["slot_bookings"]["Row"] | null }
        Returns: {
          email: string
          recipient: string
        }[]
      }
      booking_google_connected: { Args: never; Returns: boolean }
      booking_host_respond: {
        Args: { p_accept: boolean | null; p_link_id: string | null }
        Returns: undefined
      }
      booking_hosts_set: {
        Args: { p_link_id: string | null; p_user_ids: string[] | null }
        Returns: undefined
      }
      booking_op_commit: {
        Args: {
          p_attendee_email: string | null
          p_attendee_name: string | null
          p_calendar_id?: string | null
          p_cohost_ids?: string[] | null
          p_description: string | null
          p_ends_at: string | null
          p_external_event_id?: string | null
          p_host_email: string | null
          p_location: string | null
          p_owner_id: string | null
          p_source_account_id?: string | null
          p_starts_at: string | null
          p_title: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      booking_op_release: {
        Args: { p_event_id: string | null; p_owner_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      booking_rate_check: {
        Args: { p_ip_hash: string | null; p_owner_id: string | null }
        Returns: string
      }
      calendar_busy_blocks: {
        Args: { p_from: string | null; p_to: string | null; p_workspace_id: string | null }
        Returns: {
          calendar_id: string
          end_time: string
          start_time: string
        }[]
      }
      calendar_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      calendar_op__guard: {
        Args: { p_workspace_id: string | null }
        Returns: undefined
      }
      calendar_op__guard_event: {
        Args: {
          p_event_id: string | null
          p_native_only?: boolean | null
          p_workspace_id: string | null
        }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          calendar_ref: string | null
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
        Args: { p_account_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      calendar_op_account_upsert: {
        Args: {
          p_color?: string | null
          p_display_label: string | null
          p_external_id: string | null
          p_last_sync_at?: string | null
          p_provider: string | null
          p_status?: string | null
          p_sync_token?: string | null
          p_workspace_id: string | null
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
      calendar_op_create_custom: {
        Args: { p_color: string | null; p_name: string | null; p_workspace_id: string | null }
        Returns: string
      }
      calendar_op_event_create: {
        Args: {
          p_all_day?: boolean | null
          p_description?: string | null
          p_ends_at: string | null
          p_rrule?: string | null
          p_starts_at: string | null
          p_title: string | null
          p_workspace_id: string | null
        }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          calendar_ref: string | null
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
        Args: { p_event_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      calendar_op_event_restore: {
        Args: { p_event_id: string | null; p_workspace_id: string | null }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          calendar_ref: string | null
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
        Args: { p_event_id: string | null; p_patch: Json | null; p_workspace_id: string | null }
        Returns: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          calendar_ref: string | null
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
          p_account_id: string | null
          p_deleted_external_ids?: string[] | null
          p_events: Json | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      calendar_set_save: {
        Args: {
          p_calendar_ids: string[] | null
          p_name: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      can_access:
        | {
            Args: { p_id: string | null; p_min: string | null; p_type: string | null }
            Returns: boolean
          }
        | {
            Args: {
              p_id: string | null
              p_min: string | null
              p_type: string | null
              p_user: string | null
            }
            Returns: boolean
          }
      chat__activity: {
        Args: {
          p_actor: string | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_op: string | null
          p_reason: string | null
          p_team_ids?: string[] | null
          p_users: string[] | null
        }
        Returns: string
      }
      chat__blank_deleted: { Args: { p_limit?: number | null }; Returns: number }
      chat__body_refs: {
        Args: { p_body: string | null }
        Returns: {
          ref_id: string
          ref_type: string
        }[]
      }
      chat__body_runs: { Args: { p_body: string | null }; Returns: string[] }
      chat__body_text: { Args: { p_body: string | null }; Returns: string }
      chat__can_manage: {
        Args: {
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__can_post: {
        Args: {
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__can_read_channel_as: {
        Args: { p_channel_id: string | null; p_user: string | null }
        Returns: boolean
      }
      chat__chain_refresh: { Args: { p_root: string | null }; Returns: undefined }
      chat__chain_root: {
        Args: { p_root_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__chain_root_as: {
        Args: { p_root_id: string | null; p_user: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__channel_name: { Args: { p_name: string | null }; Returns: string }
      chat__channel_readers: {
        Args: { p_channel_id: string | null }
        Returns: string[]
      }
      chat__channel_topic: { Args: { p_topic: string | null }; Returns: string }
      chat__check_body: { Args: { p_body: string | null }; Returns: undefined }
      chat__check_link_target: {
        Args: {
          p_id: string | null
          p_type: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      chat__close: {
        Args: {
          p_how: string | null
          p_ids: string[] | null
          p_upto?: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_user: string | null
        }
        Returns: number
      }
      chat__close_channel_items: {
        Args: { p_channel_id: string | null; p_users?: string[] | null }
        Returns: number
      }
      chat__close_read: {
        Args: {
          p_channel_id: string | null
          p_upto: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_user: string | null
        }
        Returns: number
      }
      chat__create_channel_as: {
        Args: {
          p_announcement: boolean | null
          p_is_private: boolean | null
          p_link_id: string | null
          p_link_type: string | null
          p_member_ids: string[] | null
          p_name: string | null
          p_names_of: string | null
          p_topic: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__emoji_live: {
        Args: { p_key: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      chat__emoji_name_reserved: { Args: { p_name: string | null }; Returns: boolean }
      chat__enter: {
        Args: {
          p_channel_id: string | null
          p_level?: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      chat__excerpt: { Args: { p_body: string | null }; Returns: string }
      chat__fan_out: {
        Args: {
          p_actor: string | null
          p_before?: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
        }
        Returns: undefined
      }
      chat__fire_later: {
        Args: { p_limit?: number | null; p_now?: string | null }
        Returns: number
      }
      chat__hand_over: {
        Args: { p_channel_id: string | null; p_leaving: string | null }
        Returns: string
      }
      chat__inline_scan: {
        Args: { p_src: string | null }
        Returns: Record<string, unknown>
      }
      chat__inline_text: { Args: { p_src: string | null }; Returns: string }
      chat__is_iso_day: { Args: { p_day: string | null }; Returns: boolean }
      chat__is_manager: {
        Args: {
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__key_actor: {
        Args: { p_need: string | null }
        Returns: Record<string, unknown>
      }
      chat__key_channel_ids: {
        Args: {
          p_creator: string | null
          p_private_ok: boolean | null
          p_workspace_id: string | null
        }
        Returns: string[]
      }
      chat__key_message: {
        Args: { p_message_id: string | null; p_need: string | null; p_workspace_id: string | null }
        Returns: string
      }
      chat__key_reads_channel: {
        Args: { p_channel_id: string | null; p_creator: string | null; p_private_ok: boolean | null }
        Returns: boolean
      }
      chat__key_replies_on: {
        Args: { p_key: string | null; p_user: string | null }
        Returns: boolean
      }
      chat__link_mentions: {
        Args: {
          p_actor: string | null
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
        }
        Returns: number
      }
      chat__link_type: { Args: { p_type: string | null }; Returns: string }
      chat__links_to: {
        Args: { p_channel_id: string | null; p_id: string | null; p_type: string | null }
        Returns: boolean
      }
      chat__list_marker: { Args: { p_line: string | null }; Returns: string[] }
      chat__lock_name: {
        Args: { p_name: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      chat__mark_decision_as: {
        Args: { p_message_id: string | null; p_on: boolean | null; p_user: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__may_delete: {
        Args: {
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__may_restore: {
        Args: {
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__may_wrap: {
        Args: {
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_root: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_user: string | null
        }
        Returns: boolean
      }
      chat__mentions: {
        Args: { p_body: string | null }
        Returns: Record<string, unknown>
      }
      chat__mentions_inline: {
        Args: { p_src: string | null }
        Returns: Record<string, unknown>
      }
      chat__mentions_ref_at: { Args: { p_text: string | null }; Returns: boolean }
      chat__move_refile_items: {
        Args: { p_ids: string[] | null; p_to: string | null }
        Returns: undefined
      }
      chat__move_relink: {
        Args: { p_from: string | null; p_ids: string[] | null; p_to: string | null }
        Returns: undefined
      }
      chat__move_scrub_notices: {
        Args: { p_ids: string[] | null; p_to: string | null }
        Returns: undefined
      }
      chat__name_taken: {
        Args: {
          p_except: string | null
          p_name: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      chat__notice_ref: {
        Args: {
          p_id: string | null
          p_type: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      chat__notice_switch_on: {
        Args: { p_reason: string | null; p_user: string | null }
        Returns: boolean
      }
      chat__notice_text: {
        Args: { p_body: string | null; p_user: string | null; p_workspace_id: string | null }
        Returns: string
      }
      chat__notify_devices: {
        Args: {
          p_actor: string | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_reason: string | null
          p_users: string[] | null
        }
        Returns: undefined
      }
      chat__op_channel_as: {
        Args: { p_channel_id: string | null; p_user: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__op_guard_as: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      chat__op_reader_as: {
        Args: { p_channel_id: string | null; p_user: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__purge_deleted: { Args: { p_limit?: number | null }; Returns: number }
      chat__queue_waiting_emails: { Args: { p_now?: string | null }; Returns: number }
      chat__quiet_line: {
        Args: {
          p_actor: string | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_reason: string | null
          p_user: string | null
        }
        Returns: undefined
      }
      chat__react_as: {
        Args: {
          p_key: string | null
          p_message_id: string | null
          p_on: boolean | null
          p_user: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__read_covers: {
        Args: {
          p_message_id: string | null
          p_upto: Database["public"]["Tables"]["chat_messages"]["Row"] | null
        }
        Returns: boolean
      }
      chat__read_mentions: {
        Args: {
          p_actor: string | null
          p_body: string | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
        }
        Returns: Record<string, unknown>
      }
      chat__readable_channel_ids: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: string[]
      }
      chat__reads_workspace: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      chat__reopen: {
        Args: { p_ids: string[] | null; p_user: string | null }
        Returns: number
      }
      chat__reopen_chain: {
        Args: {
          p_at: string | null
          p_root: Database["public"]["Tables"]["chat_messages"]["Row"] | null
          p_user: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__search_in: {
        Args: {
          p_after: string | null
          p_before: string | null
          p_before_id: string | null
          p_channels: string[] | null
          p_from: string | null
          p_has_file: boolean | null
          p_limit: number | null
          p_query: string | null
          p_workspace_id: string | null
        }
        Returns: {
          author_id: string
          author_kind: string
          author_label: string
          channel_id: string
          channel_kind: string
          channel_name: string
          created_at: string
          message_id: string
          parent_id: string
          reply_to_id: string
          snippet: string
        }[]
      }
      chat__search_query: { Args: { p_query: string | null }; Returns: unknown }
      chat__sender_label: {
        Args: {
          p_actor: string | null
          p_msg: Database["public"]["Tables"]["chat_messages"]["Row"] | null
        }
        Returns: string
      }
      chat__set_link: {
        Args: {
          p_actor: string | null
          p_channel: Database["public"]["Tables"]["chat_channels"]["Row"] | null
          p_id: string | null
          p_type: string | null
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat__team_muted: { Args: { p_user: string | null }; Returns: boolean }
      chat__touch_roster: { Args: { p_channel_id: string | null }; Returns: undefined }
      chat__unaccent: { Args: { p_text: string | null }; Returns: string }
      chat__v1_inline: {
        Args: { p_in_italic?: boolean | null; p_text: string | null }
        Returns: string
      }
      chat__v1_prose: { Args: { p_text: string | null }; Returns: string }
      chat__v1_to_v2: { Args: { p_body: string | null }; Returns: string }
      chat__was_removed: {
        Args: { p_channel_id: string | null; p_user: string | null }
        Returns: boolean
      }
      chat__workspace_enabled: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      chat__wrap_up_as: {
        Args: {
          p_mark_decision: boolean | null
          p_root_id: string | null
          p_settled_id: string | null
          p_user: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_agent_addressed: {
        Args: { p_limit?: number | null; p_workspace_id: string | null }
        Returns: {
          author_id: string
          author_name: string
          body: string
          chain_root_id: string
          channel_id: string
          channel_name: string
          created_at: string
          item_id: string
          message_id: string
          reason: string
          via: string
        }[]
      }
      chat_agent_conversations: {
        Args: { p_workspace_id: string | null }
        Returns: {
          announcement: boolean
          archived: boolean
          id: string
          is_private: boolean
          last_message_at: string
          name: string
          topic: string
        }[]
      }
      chat_agent_messages: {
        Args: {
          p_before?: string | null
          p_before_id?: string | null
          p_channel_id: string | null
          p_limit?: number | null
          p_root_id?: string | null
        }
        Returns: {
          author_id: string
          author_name: string
          body: string
          channel_id: string
          created_at: string
          decision: boolean
          edited: boolean
          id: string
          parent_id: string
          reactions: Json
          reply_count: number
          reply_to_id: string
          settled_id: string
          via: string
          wrapped: boolean
        }[]
      }
      chat_agent_search: {
        Args: {
          p_before?: string | null
          p_before_id?: string | null
          p_channel_id?: string | null
          p_limit?: number | null
          p_query: string | null
          p_workspace_id: string | null
        }
        Returns: {
          author_id: string
          author_name: string
          channel_id: string
          channel_name: string
          created_at: string
          message_id: string
          parent_id: string
          snippet: string
          via: string
        }[]
      }
      chat_can_read_channel: {
        Args: { p_channel_id: string | null }
        Returns: boolean
      }
      chat_caps_get: { Args: { p_workspace_id: string | null }; Returns: Json }
      chat_caps_set: {
        Args: { p_caps: Json | null; p_role_key: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      chat_catchup_open: {
        Args: { p_workspace_id: string | null }
        Returns: {
          actor_id: string
          at: string
          chain_root_id: string
          channel_id: string
          channel_name: string
          created_at: string
          id: string
          later_until: string
          message_id: string
          reason: string
          returned_at: string
        }[]
      }
      chat_conversations_for_item: {
        Args: { p_id: string | null; p_type: string | null }
        Returns: {
          archived: boolean
          channel_id: string
          channel_kind: string
          channel_name: string
          channel_private: boolean
          relation: string
          since: string
          unread: number
          workspace_id: string
        }[]
      }
      chat_decisions_for_item: {
        Args: { p_id: string | null; p_type: string | null }
        Returns: {
          author_id: string
          author_kind: string
          author_label: string
          channel_id: string
          channel_kind: string
          channel_name: string
          created_at: string
          decision_at: string
          decision_by: string
          excerpt: string
          message_id: string
          parent_id: string
          with_names: string[]
          workspace_id: string
        }[]
      }
      chat_emoji__may_read: { Args: { p_name: string | null }; Returns: boolean }
      chat_emoji__may_upload: { Args: { p_name: string | null }; Returns: boolean }
      chat_emoji__path_slot: { Args: { p_name: string | null }; Returns: string }
      chat_emoji__path_workspace: { Args: { p_name: string | null }; Returns: string }
      chat_emoji__readable: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      chat_files: {
        Args: {
          p_before?: string | null
          p_before_id?: string | null
          p_channel_id: string | null
          p_limit?: number | null
        }
        Returns: {
          author_id: string
          file_name: string
          height: number
          id: string
          message_id: string
          mime: string
          object_path: string
          preview_mime: string
          preview_path: string
          sent_at: string
          size_bytes: number
          width: number
        }[]
      }
      chat_find_conversations: {
        Args: { p_limit?: number | null; p_query: string | null; p_workspace_id: string | null }
        Returns: {
          archived: boolean
          channel_id: string
          kind: string
          name: string
          people: string[]
        }[]
      }
      chat_has_cap: {
        Args: { p_cap: string | null; p_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      chat_is_workspace_admin: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      chat_is_workspace_member: {
        Args: { p_user_id: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      chat_key_readers: {
        Args: { p_channel_id: string | null }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      chat_key_scope: { Args: { p_workspace_id: string | null }; Returns: string }
      chat_link_files_here: { Args: { p_channel_id: string | null }; Returns: boolean }
      chat_message_refs: {
        Args: { p_ids: string[] | null }
        Returns: {
          author_id: string
          author_kind: string
          author_label: string
          channel_id: string
          channel_kind: string
          channel_name: string
          channel_private: boolean
          created_at: string
          deleted: boolean
          edited_at: string
          excerpt: string
          id: string
          parent_id: string
          workspace_id: string
        }[]
      }
      chat_my_keys: {
        Args: { p_workspace_id: string | null }
        Returns: {
          id: string
          name: string
        }[]
      }
      chat_now: { Args: { p_workspace_id: string | null }; Returns: Json }
      chat_op__channel: {
        Args: { p_channel_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op__guard: { Args: { p_workspace_id: string | null }; Returns: undefined }
      chat_op__reader: {
        Args: { p_channel_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_add_members: {
        Args: { p_channel_id: string | null; p_user_ids: string[] | null }
        Returns: number
      }
      chat_op_agent_create_channel: {
        Args: {
          p_is_private?: boolean | null
          p_name: string | null
          p_topic?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_agent_mark_decision: {
        Args: { p_message_id: string | null; p_on?: boolean | null; p_workspace_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_agent_post: {
        Args: {
          p_body: string | null
          p_channel_id: string | null
          p_parent_id?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_agent_react: {
        Args: {
          p_key: string | null
          p_message_id: string | null
          p_on?: boolean | null
          p_workspace_id: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_agent_wrap_up: {
        Args: {
          p_mark_decision?: boolean | null
          p_root_id: string | null
          p_settled_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_archive_channel: {
        Args: { p_archived?: boolean | null; p_channel_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_attach_to_chain: {
        Args: { p_message_id: string | null; p_reply_to_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_bootstrap: {
        Args: { p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_catchup_done: { Args: { p_item_ids: string[] | null }; Returns: number }
      chat_op_catchup_reopen: {
        Args: { p_item_ids: string[] | null }
        Returns: number
      }
      chat_op_chain_read: { Args: { p_root_id: string | null }; Returns: number }
      chat_op_create_channel: {
        Args: {
          p_announcement?: boolean | null
          p_is_private?: boolean | null
          p_link_id?: string | null
          p_link_type?: string | null
          p_member_ids?: string[] | null
          p_name: string | null
          p_topic?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_custom_emoji_add: {
        Args: {
          p_animated: boolean | null
          p_bytes: number | null
          p_height: number | null
          p_mime: string | null
          p_name: string | null
          p_upload_id: string | null
          p_width: number | null
        }
        Returns: {
          animated: boolean
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number
          id: string
          mime: string
          name: string
          poster_path: string
          storage_path: string
          updated_at: string
          width: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_custom_emoji"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_custom_emoji_begin: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      chat_op_custom_emoji_remove: {
        Args: { p_id: string | null }
        Returns: {
          animated: boolean
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number
          id: string
          mime: string
          name: string
          poster_path: string
          storage_path: string
          updated_at: string
          width: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_custom_emoji"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_delete: {
        Args: { p_message_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_delete_channel: {
        Args: { p_channel_id: string | null }
        Returns: undefined
      }
      chat_op_edit: {
        Args: { p_body: string | null; p_message_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_follow_chain: {
        Args: { p_following: boolean | null; p_message_id: string | null }
        Returns: undefined
      }
      chat_op_join: {
        Args: { p_channel_id: string | null }
        Returns: {
          access_at: string | null
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          last_read_id: string | null
          left_at: string | null
          notify_level: string
          removed_at: string | null
          removed_by: string | null
          starred: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_leave: { Args: { p_channel_id: string | null }; Returns: undefined }
      chat_op_link_channel: {
        Args: { p_channel_id: string | null; p_id?: string | null; p_type?: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_make_private: {
        Args: { p_channel_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_mark_decision: {
        Args: { p_message_id: string | null; p_on?: boolean | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_mark_read: {
        Args: { p_channel_id: string | null; p_message_id: string | null }
        Returns: undefined
      }
      chat_op_mark_unread: {
        Args: { p_channel_id: string | null; p_message_id: string | null }
        Returns: undefined
      }
      chat_op_move_messages: {
        Args: {
          p_confirm?: boolean | null
          p_ids: string[] | null
          p_target_channel_id: string | null
          p_undo?: boolean | null
        }
        Returns: Json
      }
      chat_op_open_dm: {
        Args: { p_user_ids: string[] | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_pin: {
        Args: { p_message_id: string | null; p_pinned?: boolean | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_react: {
        Args: { p_key: string | null; p_message_id: string | null; p_on: boolean | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_register_message: {
        Args: { p_message_id: string | null }
        Returns: Json
      }
      chat_op_remind: {
        Args: {
          p_at: string | null
          p_channel_id: string | null
          p_item_ids?: string[] | null
          p_message_id: string | null
        }
        Returns: number
      }
      chat_op_remove_member: {
        Args: { p_channel_id: string | null; p_user_id: string | null }
        Returns: undefined
      }
      chat_op_reopen: {
        Args: { p_root_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_restore: {
        Args: { p_message_id: string | null }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_restore_channel: {
        Args: { p_channel_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_send: {
        Args: {
          p_body: string | null
          p_channel_id: string | null
          p_id: string | null
          p_reply_to_id?: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_set_announcement: {
        Args: { p_channel_id: string | null; p_on: boolean | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_set_manager: {
        Args: { p_channel_id: string | null; p_on?: boolean | null; p_user_id: string | null }
        Returns: undefined
      }
      chat_op_set_prefs: {
        Args: {
          p_channel_id: string | null
          p_notify_level?: string | null
          p_starred?: boolean | null
        }
        Returns: {
          access_at: string | null
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          last_read_id: string | null
          left_at: string | null
          notify_level: string
          removed_at: string | null
          removed_by: string | null
          starred: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_start_conversation: {
        Args: { p_id: string | null; p_type: string | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_typing: {
        Args: { p_channel_id: string | null; p_parent_id?: string | null; p_stop?: boolean | null }
        Returns: undefined
      }
      chat_op_update_channel: {
        Args: { p_channel_id: string | null; p_name?: string | null; p_topic?: string | null }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          dm_key: string | null
          id: string
          is_default: boolean
          is_private: boolean
          kind: string
          last_message_at: string | null
          linked_at: string | null
          linked_id: string | null
          linked_type: string | null
          managers_only: boolean
          name: string | null
          purged_at: string | null
          roster_at: string | null
          topic: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_op_wrap_up: {
        Args: {
          p_mark_decision?: boolean | null
          p_root_id: string | null
          p_settled_id: string | null
        }
        Returns: {
          api_key_id: string | null
          author_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          body_text: string
          channel_id: string
          client_id: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          event: Json | null
          file_count: number
          format_version: number
          id: string
          kind: string
          last_reply_at: string | null
          mentioned_team_ids: string[]
          mentioned_user_ids: string[]
          mentions_everyone: boolean
          moved_at: string | null
          moved_by: string | null
          moved_from_channel_id: string | null
          parent_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          reactions: Json
          reopened_at: string | null
          reopened_by: string | null
          reply_count: number
          reply_to_id: string | null
          reply_user_ids: string[]
          search_tsv: unknown
          settled_id: string | null
          updated_at: string
          v1_thread_reply: boolean
          workspace_id: string
          wrapped_at: string | null
          wrapped_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_people: {
        Args: { p_workspace_id: string | null }
        Returns: {
          avatar_url: string
          display_name: string
          former: boolean
          user_id: string
        }[]
      }
      chat_realtime_topic_allowed: {
        Args: { p_topic: string | null }
        Returns: boolean
      }
      chat_realtime_topic_writable: {
        Args: { p_topic: string | null }
        Returns: boolean
      }
      chat_recently_deleted: {
        Args: { p_workspace_id: string | null }
        Returns: {
          deleted_at: string
          deleted_by: string
          id: string
          is_private: boolean
          name: string
          purge_at: string
        }[]
      }
      chat_search: {
        Args: {
          p_after?: string | null
          p_before?: string | null
          p_before_id?: string | null
          p_channel_id?: string | null
          p_from?: string | null
          p_has_file?: boolean | null
          p_limit?: number | null
          p_query: string | null
          p_workspace_id: string | null
        }
        Returns: {
          author_id: string
          author_kind: string
          author_label: string
          channel_id: string
          channel_kind: string
          channel_name: string
          created_at: string
          message_id: string
          parent_id: string
          reply_to_id: string
          snippet: string
        }[]
      }
      chat_sync_ids: {
        Args: { p_since?: string | null; p_workspace_id: string | null }
        Returns: {
          checked_at: string
          conversation_id: string
          id: string
          kind: string
        }[]
      }
      chat_unread_counts: {
        Args: { p_workspace_id: string | null }
        Returns: {
          addressed: number
          catchup: number
          channel_id: string
          mentions: number
          unread: number
        }[]
      }
      chat_workspace_enabled: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      comment_reactions__words_to_emoji: { Args: never; Returns: number }
      comments__can_remove: {
        Args: { c: Database["public"]["Tables"]["comments"]["Row"] | null }
        Returns: boolean
      }
      comments__find: {
        Args: { p_comment_id: string | null }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
      comments__item_level: {
        Args: { p_id: string | null; p_type: string | null; p_workspace_id: string | null }
        Returns: string
      }
      comments__item_seen: {
        Args: { p_id: string | null; p_type: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      comments__item_visible_to: {
        Args: {
          p_id: string | null
          p_type: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      comments_op_add: {
        Args: {
          p_body: string | null
          p_entity_icon?: string | null
          p_entity_id: string | null
          p_entity_label?: string | null
          p_entity_type: string | null
          p_mentioned_user_ids?: string[] | null
          p_workspace_id: string | null
        }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
      comments_op_add_anchored: {
        Args: {
          p_anchor_id: string | null
          p_body: string | null
          p_entity_icon?: string | null
          p_entity_id: string | null
          p_entity_label?: string | null
          p_mentioned_user_ids?: string[] | null
          p_workspace_id: string | null
        }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
      comments_op_delete: {
        Args: { p_comment_id: string | null }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
      comments_op_edit: {
        Args: {
          p_body: string | null
          p_comment_id: string | null
          p_mentioned_user_ids?: string[] | null
        }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
      comments_op_mention_teams: {
        Args: { p_comment_id: string | null; p_team_ids: string[] | null }
        Returns: undefined
      }
      comments_op_react: {
        Args: { p_comment_id: string | null; p_on?: boolean | null; p_reaction: string | null }
        Returns: {
          comment_id: string
          created_at: string
          reaction: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "comment_reactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      comments_op_resolve: {
        Args: {
          p_anchor_id: string | null
          p_entity_id: string | null
          p_resolved?: boolean | null
          p_workspace_id: string | null
        }
        Returns: number
      }
      comments_op_restore: {
        Args: { p_comment_id: string | null }
        Returns: {
          anchor_id: string | null
          author_kind: string
          author_label: string | null
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          edited_at: string | null
          entity_id: string
          entity_type: string
          id: string
          resolved_at: string | null
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
          p_domains?: string[] | null
          p_name: string | null
          p_notes_inline?: string | null
          p_website?: string | null
          p_workspace_id: string | null
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
        Args: { p_company_id: string | null; p_workspace_id: string | null }
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
        Args: { p_company_id: string | null; p_patch: Json | null; p_workspace_id: string | null }
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
          p_company_id: string | null
          p_domains?: string[] | null
          p_name?: string | null
          p_notes_inline?: string | null
          p_website?: string | null
          p_workspace_id: string | null
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
      contact_group_add: {
        Args: { p_contact_id: string | null; p_group_id: string | null }
        Returns: undefined
      }
      contact_group_create: {
        Args: { p_name: string | null; p_workspace_id: string | null }
        Returns: string
      }
      contact_merge: {
        Args: { p_drop_id: string | null; p_keep_id: string | null }
        Returns: undefined
      }
      contact_merge_candidates: { Args: never; Returns: Json }
      contacts__company_link_backfill: { Args: never; Returns: undefined }
      contacts__emails_to_jsonb: {
        Args: { p_arr: string[] | null; p_primary: string | null }
        Returns: Json
      }
      contacts__primary_value: { Args: { p_list: Json | null }; Returns: string }
      contacts__works_at_company: {
        Args: { p_contact_id: string | null; p_workspace_id: string | null }
        Returns: string
      }
      contacts_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      contacts_op__guard: {
        Args: { p_workspace_id: string | null }
        Returns: undefined
      }
      contacts_op__guard_company: {
        Args: { p_company_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      contacts_op__guard_contact: {
        Args: { p_contact_id: string | null; p_workspace_id: string | null }
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
          origin: string
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
          p_key: string | null
          p_label: string | null
          p_options?: Json | null
          p_position?: number | null
          p_type?: string | null
          p_workspace_id: string | null
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
          p_company_id?: string | null
          p_email?: string | null
          p_name: string | null
          p_notes_inline?: string | null
          p_phone?: string | null
          p_status?: string | null
          p_title?: string | null
          p_workspace_id: string | null
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
          origin: string
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
        Args: { p_contact_id: string | null; p_workspace_id: string | null }
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
          origin: string
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
        Args: { p_field_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      contacts_op_import: {
        Args: { p_rows: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      contacts_op_link: {
        Args: {
          p_contact_id: string | null
          p_contact_label?: string | null
          p_contact_type: string | null
          p_origin?: string | null
          p_relation_kind?: string | null
          p_target_icon?: string | null
          p_target_id: string | null
          p_target_label?: string | null
          p_target_type: string | null
          p_workspace_id: string | null
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
        Args: { p_contact_id: string | null; p_workspace_id: string | null }
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
          origin: string
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
        Args: { p_contact_id: string | null; p_patch: Json | null; p_workspace_id: string | null }
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
          origin: string
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
        Args: { p_contact_id: string | null; p_value: boolean | null; p_workspace_id: string | null }
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
          origin: string
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
        Args: { p_contact_id: string | null; p_status: string | null; p_workspace_id: string | null }
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
          origin: string
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
        Args: { p_link_id: string | null; p_workspace_id: string | null }
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
          p_company_id?: string | null
          p_contact_id: string | null
          p_email?: string | null
          p_name?: string | null
          p_notes_inline?: string | null
          p_phone?: string | null
          p_set_company?: boolean | null
          p_title?: string | null
          p_workspace_id: string | null
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
          origin: string
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
      email_cancel: { Args: { p_dedupe_key_prefix: string | null }; Returns: number }
      email_enqueue: {
        Args: {
          p_dedupe_key: string | null
          p_kind: string | null
          p_payload: Json | null
          p_send_after?: string | null
          p_to_email: string | null
          p_to_user_id: string | null
        }
        Returns: string
      }
      email_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      email_op__guard: { Args: { p_workspace_id: string | null }; Returns: undefined }
      email_op__guard_ref: {
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
        Args: { p_account_id: string | null; p_workspace_id: string | null }
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
          p_address: string | null
          p_color?: string | null
          p_provider: string | null
          p_signature_html?: string | null
          p_status?: string | null
          p_unread_count?: number | null
          p_workspace_id: string | null
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
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
          p_follow_up_at: string | null
          p_ref_id: string | null
          p_workspace_id: string | null
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
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
          p_origin?: string | null
          p_relation_kind?: string | null
          p_target_icon?: string | null
          p_target_id: string | null
          p_target_label?: string | null
          p_target_type: string | null
          p_thread_id: string | null
          p_thread_label?: string | null
          p_workspace_id: string | null
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
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
          p_account_id?: string | null
          p_from_addr?: string | null
          p_from_name?: string | null
          p_message_key?: string | null
          p_sent_at?: string | null
          p_snippet?: string | null
          p_subject?: string | null
          p_thread_key: string | null
          p_workspace_id: string | null
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
          p_ref_id: string | null
          p_snooze_until: string | null
          p_workspace_id: string | null
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
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
        Args: { p_ref_id: string | null; p_workspace_id: string | null }
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
      email_outbox__authorize: { Args: { p_secret: string | null }; Returns: boolean }
      email_outbox__claim: {
        Args: { p_lease_seconds?: number | null; p_limit?: number | null }
        Returns: {
          attempts: number
          dedupe_key: string
          id: string
          kind: string
          payload: Json
          stream: string
          to_email: string
          to_user_id: string
        }[]
      }
      email_outbox__delivered: {
        Args: { p_at: string | null; p_provider_id: string | null }
        Returns: number
      }
      email_outbox__finish: {
        Args: {
          p_error?: string | null
          p_id: string | null
          p_outcome: string | null
          p_provider_id?: string | null
          p_retry_at?: string | null
        }
        Returns: string
      }
      email_outbox__health: { Args: never; Returns: string }
      email_outbox__kick: { Args: never; Returns: number }
      email_outbox__purge: { Args: never; Returns: number }
      email_outbox__run_start: {
        Args: { p_lease_seconds?: number | null }
        Returns: string
      }
      email_outbox__run_stop: { Args: { p_token: string | null }; Returns: undefined }
      email_outbox__tick: { Args: never; Returns: number }
      email_suppression__add: {
        Args: {
          p_email: string | null
          p_provider_event_id?: string | null
          p_reason: string | null
        }
        Returns: boolean
      }
      entities_op_ensure: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_icon?: string | null
          p_label?: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      entities_op_tombstone: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      entities_op_upsert: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_icon?: string | null
          p_label?: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      focus__release_held: {
        Args: {
          p_summary: boolean | null
          p_tag: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: number
      }
      focus_claims: {
        Args: { p_workspace_id: string | null }
        Returns: {
          task_id: string
          user_id: string
        }[]
      }
      focus_op_run_end: {
        Args: { p_device: string | null; p_run_id: string | null; p_state?: Json | null }
        Returns: {
          blocks_completed: number
          control_at: string
          created_at: string
          device_id: string
          done_task_ids: string[]
          ended_at: string | null
          focused_seconds: number
          id: string
          mode: string
          now_task_id: string | null
          paused_at: string | null
          phase: string
          phase_seconds: number | null
          phase_started_at: string
          seen_at: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "focus_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      focus_op_run_save: {
        Args: {
          p_device: string | null
          p_run_id: string | null
          p_state: Json | null
          p_take: boolean | null
        }
        Returns: {
          blocks_completed: number
          control_at: string
          created_at: string
          device_id: string
          done_task_ids: string[]
          ended_at: string | null
          focused_seconds: number
          id: string
          mode: string
          now_task_id: string | null
          paused_at: string | null
          phase: string
          phase_seconds: number | null
          phase_started_at: string
          seen_at: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "focus_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      focus_op_run_start: {
        Args: {
          p_device: string | null
          p_mode: string | null
          p_state?: Json | null
          p_workspace_id: string | null
        }
        Returns: {
          blocks_completed: number
          control_at: string
          created_at: string
          device_id: string
          done_task_ids: string[]
          ended_at: string | null
          focused_seconds: number
          id: string
          mode: string
          now_task_id: string | null
          paused_at: string | null
          phase: string
          phase_seconds: number | null
          phase_started_at: string
          seen_at: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "focus_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      focus_runs__apply: {
        Args: {
          p_state: Json | null
          r: Database["public"]["Tables"]["focus_runs"]["Row"] | null
        }
        Returns: {
          blocks_completed: number
          control_at: string
          created_at: string
          device_id: string
          done_task_ids: string[]
          ended_at: string | null
          focused_seconds: number
          id: string
          mode: string
          now_task_id: string | null
          paused_at: string | null
          phase: string
          phase_seconds: number | null
          phase_started_at: string
          seen_at: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "focus_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      focus_runs__clamp: { Args: { p_at: string | null }; Returns: string }
      focus_runs__lock: { Args: { p_user: string | null }; Returns: undefined }
      focus_runs__release_stale: { Args: { p_now: string | null }; Returns: number }
      focus_runs__runner: { Args: { p_workspace_id: string | null }; Returns: string }
      grant_level_rank: { Args: { p_level: string | null }; Returns: number }
      hook_before_user_created: { Args: { event: Json | null }; Returns: Json }
      imports__open: {
        Args: { p_import_id: string | null; p_workspace_id: string | null }
        Returns: {
          finished_at: string | null
          id: string
          key_id: string | null
          label: string | null
          source: string
          started_at: string
          undone_at: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      imports__own: {
        Args: { p_import_id: string | null; p_workspace_id: string | null }
        Returns: {
          finished_at: string | null
          id: string
          key_id: string | null
          label: string | null
          source: string
          started_at: string
          undone_at: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      imports__summary: {
        Args: { i: Database["public"]["Tables"]["imports"]["Row"] | null }
        Returns: Json
      }
      imports_op_begin: {
        Args: { p_label?: string | null; p_source: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      imports_op_finish: {
        Args: { p_import_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      imports_op_project_create: {
        Args: { p_import_id: string | null; p_project: Json | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      imports_op_section_create: {
        Args: {
          p_import_id: string | null
          p_project_id: string | null
          p_section: Json | null
          p_workspace_id: string | null
        }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      imports_op_undo: {
        Args: { p_import_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      links_op_create: {
        Args: {
          p_origin?: string | null
          p_relation_kind?: string | null
          p_source_icon?: string | null
          p_source_id: string | null
          p_source_label?: string | null
          p_source_type: string | null
          p_target_icon?: string | null
          p_target_id: string | null
          p_target_label?: string | null
          p_target_type: string | null
          p_workspace_id: string | null
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
          p_source_id: string | null
          p_source_type: string | null
          p_target_id: string | null
          p_target_type: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      links_op_delete: {
        Args: { p_link_id: string | null; p_workspace_id: string | null }
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
          p_link_id: string | null
          p_relation_kind: string | null
          p_workspace_id: string | null
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
          p_entity_id: string | null
          p_entity_type: string | null
          p_limit?: number | null
          p_workspace_id: string | null
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
          p_entity_id: string | null
          p_entity_type: string | null
          p_module: string | null
          p_op: string | null
          p_payload: Json | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      module_api_key_cap: {
        Args: { p_module: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: string
      }
      module_api_key_creator: { Args: never; Returns: string }
      module_api_key_effective_scopes: {
        Args: { p_key_id: string | null }
        Returns: Json
      }
      module_api_key_id: { Args: never; Returns: string }
      module_api_key_scope: {
        Args: { p_lane: string | null; p_scope_key: string | null; p_workspace_id: string | null }
        Returns: string
      }
      module_member_permission: {
        Args: { p_lane: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: string
      }
      notes__keep_access_on_reroot: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      notes__purge_ids: {
        Args: { p_ids: string[] | null; p_workspace_id: string | null }
        Returns: number
      }
      notes__subtree_ids: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: string[]
      }
      notes_list_unmaterialized: {
        Args: { p_limit?: number | null; p_workspace_id: string | null }
        Returns: {
          o_body_md: string
          o_id: string
        }[]
      }
      notes_live__fresh: { Args: never; Returns: string }
      notes_live__tell: {
        Args: { p_event: string | null; p_note_id: string | null; p_payload: Json | null }
        Returns: undefined
      }
      notes_live__viewers: { Args: { p_note_id: string | null }; Returns: string[] }
      notes_live_here: {
        Args: { p_leaving?: boolean | null; p_note_id: string | null; p_session_id: string | null }
        Returns: string[]
      }
      notes_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      notes_op__guard: { Args: { p_workspace_id: string | null }; Returns: undefined }
      notes_op__guard_note: {
        Args: {
          p_include_trashed?: boolean | null
          p_note_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
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
          p_body_md?: string | null
          p_body_text?: string | null
          p_client_id: string | null
          p_note_id: string | null
          p_updates: Json | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      notes_op_archive: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
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
          p_icon?: string | null
          p_id?: string | null
          p_parent_id?: string | null
          p_position?: string | null
          p_title?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
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
          p_position?: string | null
          p_source_note_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_file: {
        Args: {
          p_in_inbox: boolean | null
          p_note_id: string | null
          p_position?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_import: {
        Args: { p_rows: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      notes_op_mention: {
        Args: {
          p_mentioned_user_ids: string[] | null
          p_note_id: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      notes_op_move: {
        Args: {
          p_follow_parent?: boolean | null
          p_note_id: string | null
          p_parent_id?: string | null
          p_position?: string | null
          p_workspace_id: string | null
        }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_publish: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_purge: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      notes_op_purge_expired: {
        Args: { p_workspace_id: string | null }
        Returns: Json
      }
      notes_op_rename: {
        Args: { p_note_id: string | null; p_title: string | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_restore: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      notes_op_save_snapshot: {
        Args: {
          p_body_md?: string | null
          p_body_text?: string | null
          p_expected_doc_version?: number | null
          p_note_id: string | null
          p_snapshot_b64: string | null
          p_upto_update_id: number | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      notes_op_seed_doc: {
        Args: {
          p_body_md?: string | null
          p_body_text?: string | null
          p_doc_state_b64: string | null
          p_note_id: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      notes_op_set_favorite: {
        Args: {
          p_note_id: string | null
          p_position?: string | null
          p_value: boolean | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      notes_op_set_meta: {
        Args: { p_note_id: string | null; p_patch: Json | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_trash: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      notes_op_unarchive: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_op_unpublish: {
        Args: { p_note_id: string | null; p_workspace_id: string | null }
        Returns: {
          body_md: string
          body_text: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc_state: string | null
          doc_version: number
          edited_at: string | null
          edited_by: string | null
          full_width: boolean
          icon: string | null
          id: string
          in_inbox: boolean
          is_archived: boolean
          is_pinned: boolean
          kind: string
          parent_id: string | null
          position: string
          publish_token: string | null
          published_at: string | null
          search_tsv: unknown
          share_mode: string
          share_permission: string
          share_scope: string
          tags: Json
          title: string
          updated_at: string
          workspace_id: string
          workspace_shared: boolean
        }
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notes_public_subtree: { Args: { p_token: string | null }; Returns: Json }
      notice__gate: {
        Args: {
          p_at: string | null
          p_kind: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      notice_deliveries__authorize: {
        Args: { p_secret: string | null }
        Returns: boolean
      }
      notice_deliveries__chat_visible: {
        Args: { p_channel_id: string | null; p_message_id: string | null }
        Returns: boolean
      }
      notice_deliveries__claim: {
        Args: { p_limit?: number | null }
        Returns: {
          body: string
          id: string
          kind: string
          subscriptions: Json
          tag: string
          task_id: string
          title: string
          url: string
          user_id: string
        }[]
      }
      notice_deliveries__kick: { Args: never; Returns: number }
      notice_deliveries__next_due: { Args: never; Returns: number }
      notice_deliveries__purge: { Args: never; Returns: number }
      notice_deliveries__settle: { Args: { p_results: Json | null }; Returns: number }
      notice_op_ack: { Args: { p_ids: string[] | null }; Returns: number }
      notifications_list: {
        Args: { p_limit?: number | null; p_workspace_id: string | null }
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
        Args: { p_activity_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      notifications_op_mark_all_read: {
        Args: { p_workspace_id: string | null }
        Returns: undefined
      }
      notifications_op_mark_read: {
        Args: { p_activity_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      notifications_op_undismiss: {
        Args: { p_activity_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      perm_actor_id: { Args: never; Returns: string }
      perm_all_keys: { Args: never; Returns: string[] }
      perm_can_edit_entity: {
        Args: { p_id: string | null; p_type: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_can_grant: {
        Args: { p_actor: string | null; p_keys: string[] | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_can_manage_member: {
        Args: { p_actor: string | null; p_target_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_can_see_entity: {
        Args: { p_id: string | null; p_type: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_can_tag: { Args: { p_workspace_id: string | null }; Returns: boolean }
      perm_can_view: {
        Args: { p_module: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_can_view_entity: {
        Args: { p_entity_type: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_ceiling_rank: {
        Args: { p_module: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: number
      }
      perm_effective: {
        Args: { p_user_id: string | null; p_workspace_id: string | null }
        Returns: string[]
      }
      perm_entity_module: { Args: { p_entity_type: string | null }; Returns: string }
      perm_i_have: {
        Args: { p_key: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_is_owner: {
        Args: { p_user_id: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_legacy_overrides: {
        Args: { p_notes: string | null; p_tasks: string | null }
        Returns: Json
      }
      perm_rank: { Args: { p_level: string | null }; Returns: number }
      perm_resolve: {
        Args: {
          p_overrides: Json | null
          p_read_only: boolean | null
          p_role_permissions: string[] | null
        }
        Returns: string[]
      }
      perm_role_tier: {
        Args: { p_role: Database["public"]["Tables"]["workspace_roles"]["Row"] | null }
        Returns: string
      }
      perm_scope_lane: { Args: { p_scope_key: string | null }; Returns: string }
      perm_seed_workspace_roles: {
        Args: { p_workspace_id: string | null }
        Returns: undefined
      }
      perm_system_role_id: {
        Args: { p_tier: string | null; p_workspace_id: string | null }
        Returns: string
      }
      perm_system_role_permissions: {
        Args: { p_system_key: string | null }
        Returns: string[]
      }
      perm_user_has: {
        Args: { p_key: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      perm_validate_overrides: { Args: { p_overrides: Json | null }; Returns: Json }
      plan_tier_rank: { Args: { t: string | null }; Returns: number }
      prefs_op_set: {
        Args: { p_domain: string | null; p_updated_at: string | null; p_value: Json | null }
        Returns: Json
      }
      profile_plan_tier_text: { Args: { p_user_id: string | null }; Returns: string }
      project_statuses__check_name: {
        Args: {
          p_category: string | null
          p_except: string | null
          p_name: string | null
          p_project_id: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      project_statuses__guard: {
        Args: { p_project_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      project_statuses__seed: {
        Args: { p_project_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      project_statuses__set_rows: {
        Args: { p_project_id: string | null; p_workspace_id: string | null }
        Returns: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_statuses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      project_statuses_op_create: {
        Args: {
          p_category: string | null
          p_name: string | null
          p_project_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_statuses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      project_statuses_op_delete: {
        Args: { p_status_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      project_statuses_op_update: {
        Args: { p_patch: Json | null; p_status_id: string | null; p_workspace_id: string | null }
        Returns: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_statuses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      project_templates__apply_body: {
        Args: {
          p_body: Json | null
          p_fields: Json | null
          p_private: boolean | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      project_templates__body_of: {
        Args: { p_actor: string | null; p_project_id: string | null }
        Returns: Json
      }
      project_templates_op_apply: {
        Args: { p_fields: Json | null; p_template_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      project_templates_op_save: {
        Args: { p_fields: Json | null; p_project_id: string | null; p_workspace_id: string | null }
        Returns: {
          body: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          private_source: boolean
          shareable: boolean
          shared: boolean
          source_ids: string[]
          summary: Json
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      project_templates_op_starter: {
        Args: { p_fields: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      projects__apply_fields: {
        Args: {
          b: Database["public"]["Tables"]["buckets"]["Row"] | null
          p_fields: Json | null
        }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      projects__editable: { Args: { p_project_id: string | null }; Returns: boolean }
      projects__editable_to: {
        Args: { p_project_id: string | null; p_user: string | null }
        Returns: boolean
      }
      projects__end_position: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      projects__guard: {
        Args: { p_project_id: string | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      projects__guard_full: {
        Args: {
          b: Database["public"]["Tables"]["buckets"]["Row"] | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      projects__visible: { Args: { p_project_id: string | null }; Returns: boolean }
      projects__visible_to: {
        Args: { p_project_id: string | null; p_user: string | null }
        Returns: boolean
      }
      projects_op_create: {
        Args: { p_project: Json | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      projects_op_delete: {
        Args: { p_project_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      projects_op_duplicate: {
        Args: { p_fields: Json | null; p_project_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      projects_op_file: {
        Args: {
          p_area_name: string | null
          p_project_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      projects_op_move: {
        Args: {
          p_area_id: string | null
          p_position?: string | null
          p_project_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      projects_op_update: {
        Args: { p_patch: Json | null; p_project_id: string | null; p_workspace_id: string | null }
        Returns: {
          archived_at: string | null
          area_id: string | null
          client_company_id: string | null
          client_contact_id: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          group_label: string | null
          id: string
          is_system: boolean
          lead_id: string | null
          name: string
          owner_id: string | null
          position: string
          starts_on: string | null
          status: string
          target_on: string | null
          trash_moved: Json | null
          trash_moved_at: string | null
          trash_moved_task_ids: string[] | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge__preview: { Args: never; Returns: Json }
      push__endpoint_ok: { Args: { p_endpoint: string | null }; Returns: boolean }
      push_op_subscribe: {
        Args: {
          p_auth: string | null
          p_endpoint: string | null
          p_p256dh: string | null
          p_user_agent?: string | null
        }
        Returns: undefined
      }
      push_op_unsubscribe: { Args: { p_endpoint: string | null }; Returns: undefined }
      reactions__custom_key_pattern: { Args: never; Returns: string }
      reactions__key_canonical: { Args: { p_key: string | null }; Returns: string }
      reactions__key_ok: { Args: { p_key: string | null }; Returns: boolean }
      reactions__key_pattern: { Args: never; Returns: string }
      reactions__respell_stored: { Args: never; Returns: number }
      recompute_entitlement: { Args: { p_user: string | null }; Returns: undefined }
      sections__check_dates: {
        Args: { p_ends: string | null; p_starts: string | null }
        Returns: undefined
      }
      sections__list: {
        Args: { p_project_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sections_op_create: {
        Args: { p_project_id: string | null; p_section: Json | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sections_op_move: {
        Args: { p_after: string | null; p_section_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sections_op_update: {
        Args: { p_patch: Json | null; p_section_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          name: string
          position: number
          project_id: string
          starts_on: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      share_apply_invite: {
        Args: { p_invite_id: string | null; p_user_id: string | null }
        Returns: undefined
      }
      share_assign_preview: {
        Args: { p_bucket_id: string | null; p_user_id: string | null }
        Returns: string
      }
      share_default_calendar_grant: {
        Args: { p_calendar_id: string | null }
        Returns: undefined
      }
      share_defaults_get: { Args: { p_workspace_id: string | null }; Returns: Json }
      share_defaults_set: {
        Args: {
          p_buckets: string | null
          p_calendars: string | null
          p_contacts: string | null
          p_notes: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      share_direct_rank: {
        Args: { p_id: string | null; p_type: string | null; p_user: string | null }
        Returns: number
      }
      share_ensure_account_calendar: {
        Args: { p_account_id: string | null }
        Returns: string
      }
      share_ensure_moduo_calendar: {
        Args: { p_owner_id: string | null; p_workspace_id: string | null }
        Returns: string
      }
      share_grant_workspace: {
        Args: {
          p_id: string | null
          p_level: string | null
          p_type: string | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      share_member_count: { Args: { p_workspace_id: string | null }; Returns: number }
      share_op_follow_parent: {
        Args: { p_note_id: string | null }
        Returns: undefined
      }
      share_op_make_private: {
        Args: { p_id: string | null; p_type: string | null }
        Returns: undefined
      }
      share_op_set: {
        Args: {
          p_id: string | null
          p_level: string | null
          p_subject_id: string | null
          p_subject_type: string | null
          p_type: string | null
        }
        Returns: undefined
      }
      share_op_state: { Args: { p_id: string | null; p_type: string | null }; Returns: Json }
      share_visible_ids: {
        Args: { p_resource_type: string | null; p_workspace_id: string | null }
        Returns: string[]
      }
      spine__visible_to: {
        Args: {
          p_id: string | null
          p_type: string | null
          p_user: string | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      spine_activity_targets_me: {
        Args: {
          p_activity: Database["public"]["Tables"]["module_activity"]["Row"] | null
        }
        Returns: boolean
      }
      spine_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      spine_op__guard: { Args: { p_workspace_id: string | null }; Returns: undefined }
      spine_pair_key: {
        Args: { a_id: string | null; a_type: string | null; b_id: string | null; b_type: string | null }
        Returns: string
      }
      storage__limits_for_owner: {
        Args: { p_owner: string | null }
        Returns: {
          per_file_bytes: number
          tier: string
          total_bytes: number
        }[]
      }
      storage__unsettled_bytes: { Args: { p_owner: string | null }; Returns: number }
      storage_status: { Args: { p_workspace_id: string | null }; Returns: Json }
      storage_usage__add: {
        Args: { p_delta: number | null; p_owner: string | null }
        Returns: undefined
      }
      storage_usage__reconcile: { Args: never; Returns: number }
      tags_insert_keeps_owner: {
        Args: { p_id: string | null; p_owner: string | null }
        Returns: boolean
      }
      task_templates__body_of: {
        Args: { p_actor: string | null; p_task_id: string | null }
        Returns: Json
      }
      task_templates_op_apply: {
        Args: { p_fields: Json | null; p_template_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      task_templates_op_save: {
        Args: { p_fields: Json | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          body: Json
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          private_source: boolean
          shareable: boolean
          shared: boolean
          source_ids: string[]
          summary: Json
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "task_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_views__actor: { Args: { p_workspace_id: string | null }; Returns: string }
      task_views__check_display: { Args: { p_display: Json | null }; Returns: Json }
      task_views__check_filters: {
        Args: { p_actor: string | null; p_filters: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      task_views__readable: { Args: { p_view_id: string | null }; Returns: boolean }
      task_views__sees: {
        Args: {
          p_actor: string | null
          p_owner: string | null
          p_project: string | null
          p_shared: boolean | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      task_views_op_create: {
        Args: { p_fields: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      task_views_op_move: {
        Args: { p_direction: string | null; p_view_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      task_views_op_update: {
        Args: { p_patch: Json | null; p_view_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks__after_completion_next: {
        Args: {
          p_done_at: string | null
          p_fallback: string | null
          p_rec: Json | null
          p_zone: string | null
        }
        Returns: string
      }
      tasks__apply_status: {
        Args: {
          p_position: string | null
          p_recurrence: Json | null
          p_status: string | null
          t: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks__backfill_areas: {
        Args: { p_workspace_id?: string | null }
        Returns: number
      }
      tasks__busy_sessions: {
        Args: {
          p_from: string | null
          p_to: string | null
          p_user_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      tasks__can_hold_session: {
        Args: { p_task_id: string | null; p_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      tasks__category_rank: { Args: { p_category: string | null }; Returns: number }
      tasks__check_assignee: {
        Args: { p_assignee_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks__check_bucket: {
        Args: { p_bucket_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks__check_keys: {
        Args: { p_allowed: string[] | null; p_fields: Json | null }
        Returns: undefined
      }
      tasks__check_parent: {
        Args: { p_parent_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks__check_recurrence: { Args: { p_rec: Json | null }; Returns: undefined }
      tasks__check_session_person: {
        Args: {
          p_user: string | null
          t: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: undefined
      }
      tasks__clean_name: {
        Args: { p_max: number | null; p_name: string | null; p_what: string | null }
        Returns: string
      }
      tasks__clean_time_blocks: {
        Args: { p_blocks: Json | null; p_user: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks__created_done: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: undefined
      }
      tasks__cycle_key: {
        Args: {
          p_now: string | null
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: string
      }
      tasks__date_only: { Args: { p_value: string | null }; Returns: string }
      tasks__due_at: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: string
      }
      tasks__due_instant: {
        Args: {
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
          p_zone: string | null
        }
        Returns: string
      }
      tasks__due_noon: { Args: { p_on: string | null }; Returns: string }
      tasks__due_on_of: {
        Args: { p_at: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__editable: { Args: { p_task_id: string | null }; Returns: boolean }
      tasks__editable_to: {
        Args: { p_task_id: string | null; p_user: string | null }
        Returns: boolean
      }
      tasks__end_position: { Args: { p_bucket_id: string | null }; Returns: string }
      tasks__fire_reminders: {
        Args: { p_limit?: number | null; p_now?: string | null }
        Returns: number
      }
      tasks__first_status: {
        Args: { p_category: string | null; p_set: string | null; p_workspace_id: string | null }
        Returns: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_statuses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks__floating: {
        Args: { p_at: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__guard_edit: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks__guard_structure: {
        Args: { p_workspace_id: string | null }
        Returns: undefined
      }
      tasks__hand_to_inbox: {
        Args: { p_task_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks__inbox: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: string
      }
      tasks__is_member: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      tasks__iso: { Args: { p_at: string | null }; Returns: string }
      tasks__json_object: { Args: { p_value: Json | null }; Returns: Json }
      tasks__known_zone: { Args: { p_user: string | null }; Returns: string }
      tasks__late: {
        Args: {
          p_now?: string | null
          t: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: boolean
      }
      tasks__legacy_status: { Args: { p_category: string | null }; Returns: string }
      tasks__local_date: {
        Args: { p_at: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__local_midnight: {
        Args: { p_day: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__next_number: { Args: { p_workspace_id: string | null }; Returns: number }
      tasks__next_session: {
        Args: { p_now: string | null; p_task_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "task_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks__notice: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_op: string | null
          p_payload: Json | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      tasks__occurrence_of: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: string
      }
      tasks__on_pattern: {
        Args: {
          p_at: string | null
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
          p_zone: string | null
        }
        Returns: boolean
      }
      tasks__patch_date: {
        Args: { p_key: string | null; p_patch: Json | null }
        Returns: string
      }
      tasks__pattern_slot: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: string
      }
      tasks__pointer_on_complete: {
        Args: {
          p_now: string | null
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: Json
      }
      tasks__pointer_on_reopen: {
        Args: {
          p_now: string | null
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: Json
      }
      tasks__purge_expired: { Args: { p_limit?: number | null }; Returns: Json }
      tasks__put_time_blocks: {
        Args: { p_blocks: Json | null; p_user: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks__record_completion: {
        Args: { p_at: string | null; t: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: undefined
      }
      tasks__recurrence_problem: { Args: { p_rec: Json | null }; Returns: string }
      tasks__register: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: undefined
      }
      tasks__reminder_at: {
        Args: {
          p_kind: string | null
          t: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: string
      }
      tasks__reminders_of: {
        Args: { p_task_id: string | null; p_user: string | null }
        Returns: {
          at: string | null
          created_at: string
          deleted_at: string | null
          fired_at: string | null
          id: string
          kind: string
          suspended_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_reminders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks__reorder: {
        Args: { p_after: string | null; p_id: string | null; p_order: string[] | null }
        Returns: string[]
      }
      tasks__resolve_status: {
        Args: {
          p_bucket_id: string | null
          p_current?: string | null
          p_value: string | null
          p_workspace_id: string | null
        }
        Returns: {
          category: string
          created_at: string
          deleted_at: string | null
          hidden: boolean
          id: string
          name: string
          position: number
          project_id: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_statuses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks__roll_over: {
        Args: {
          p_budget?: string | null
          p_limit?: number | null
          p_now?: string | null
          p_workspace_id?: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks__rrule_days: {
        Args: {
          p: Json | null
          p_desc: boolean | null
          p_dt0: string | null
          p_from: string | null
          p_limit: number | null
          p_to: string | null
        }
        Returns: string[]
      }
      tasks__rrule_floating: {
        Args: { p_fallback: string | null; p_rec: Json | null; p_zone: string | null }
        Returns: Json
      }
      tasks__rrule_next: {
        Args: {
          p_after: string | null
          p_fallback: string | null
          p_inclusive?: boolean | null
          p_rec: Json | null
        }
        Returns: string
      }
      tasks__rrule_next_in: {
        Args: {
          p_after: string | null
          p_fallback: string | null
          p_inclusive?: boolean | null
          p_rec: Json | null
          p_zone: string | null
        }
        Returns: string
      }
      tasks__rrule_parse: { Args: { p_rrule: string | null }; Returns: Json }
      tasks__rrule_prev: {
        Args: { p_at: string | null; p_fallback: string | null; p_rec: Json | null }
        Returns: string
      }
      tasks__rrule_prev_in: {
        Args: { p_at: string | null; p_fallback: string | null; p_rec: Json | null; p_zone: string | null }
        Returns: string
      }
      tasks__rrule_start: {
        Args: { p_fallback: string | null; p_rec: Json | null }
        Returns: string
      }
      tasks__rule_signature: { Args: { p_rec: Json | null }; Returns: string }
      tasks__rule_time: {
        Args: {
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
          p_zone: string | null
        }
        Returns: string
      }
      tasks__session_mirror: { Args: { p_task_id: string | null }; Returns: undefined }
      tasks__session_mirror_refresh: {
        Args: { p_limit?: number | null }
        Returns: number
      }
      tasks__session_times: {
        Args: { p_ends: string | null; p_fields: Json | null; p_starts: string | null }
        Returns: Record<string, unknown>
      }
      tasks__session_unbacklog: {
        Args: { p_task_id: string | null }
        Returns: undefined
      }
      tasks__sessions_of: {
        Args: { p_task_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks__shift_dates: {
        Args: {
          p_days: number | null
          p_exact: string | null
          p_old: string | null
          p_task: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks__status_category_of: { Args: { p_word: string | null }; Returns: string }
      tasks__status_in_set: {
        Args: {
          p_set: string | null
          p_status: Database["public"]["Tables"]["project_statuses"]["Row"] | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      tasks__status_set: { Args: { p_bucket_id: string | null }; Returns: string }
      tasks__team_check_backs: {
        Args: { p_limit?: number | null; p_now?: string | null }
        Returns: number
      }
      tasks__try_ts: { Args: { p_value: string | null }; Returns: string }
      tasks__try_uuid: { Args: { p_value: string | null }; Returns: string }
      tasks__unfloating: {
        Args: { p_at: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__visible: { Args: { p_task_id: string | null }; Returns: boolean }
      tasks__visible_to: {
        Args: { p_task_id: string | null; p_user: string | null }
        Returns: boolean
      }
      tasks__waiting_came_in: {
        Args: {
          p_entry: Database["public"]["Tables"]["task_waiting"]["Row"] | null
          p_reason: string | null
        }
        Returns: undefined
      }
      tasks__waiting_of: {
        Args: { p_task_id: string | null }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          label: string | null
          ref: string | null
          since: string
          task_id: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_waiting"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks__wall_clock: {
        Args: { p_at: string | null; p_zone: string | null }
        Returns: string
      }
      tasks__zone_of: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: string
      }
      tasks_agent_sessions: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks_late: {
        Args: { t: Database["public"]["Tables"]["tasks"]["Row"] | null }
        Returns: boolean
      }
      tasks_module_can_access_workspace: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      tasks_module_permission: {
        Args: { p_workspace_id: string | null }
        Returns: string
      }
      tasks_op__guard: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_agent_report: {
        Args: { p_report: Json | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          agent: string
          created_at: string
          deleted_at: string | null
          earlier: Json
          id: string
          key_id: string | null
          links: Json
          note: string | null
          started_at: string
          state: string
          step: number | null
          steps: number | null
          stopped_at: string | null
          summary_at: string | null
          summary_posted_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_agent_session_dismiss: {
        Args: { p_session_id: string | null; p_workspace_id: string | null }
        Returns: {
          agent: string
          created_at: string
          deleted_at: string | null
          earlier: Json
          id: string
          key_id: string | null
          links: Json
          note: string | null
          started_at: string
          state: string
          step: number | null
          steps: number | null
          stopped_at: string | null
          summary_at: string | null
          summary_posted_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_agent_session_post: {
        Args: { p_session_id: string | null; p_workspace_id: string | null }
        Returns: {
          agent: string
          created_at: string
          deleted_at: string | null
          earlier: Json
          id: string
          key_id: string | null
          links: Json
          note: string | null
          started_at: string
          state: string
          step: number | null
          steps: number | null
          stopped_at: string | null
          summary_at: string | null
          summary_posted_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tasks_op_assign: {
        Args: {
          p_assignee_id: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
        Args: { p_items: Json | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_claim: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_commit: {
        Args: { p_for: string | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_create: {
        Args: { p_task: Json | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_create_with: {
        Args: { p_task: Json | null; p_with?: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks_op_history: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks_op_mention: {
        Args: {
          p_task_id: string | null
          p_user_ids: string[] | null
          p_workspace_id: string | null
        }
        Returns: number
      }
      tasks_op_move_occurrence: {
        Args: {
          p_due_on?: string | null
          p_starts_at?: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_queue_add: {
        Args: { p_at?: string | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_queue_keep: {
        Args: { p_workspace_id: string | null }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_queue_move_to_end: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_queue_remove: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_queue_reorder: {
        Args: {
          p_after_task_id?: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_reminder_add: {
        Args: {
          p_at?: string | null
          p_kind: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          at: string | null
          created_at: string
          deleted_at: string | null
          fired_at: string | null
          id: string
          kind: string
          suspended_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_reminders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_reminder_remove: {
        Args: { p_reminder_id: string | null; p_workspace_id: string | null }
        Returns: {
          at: string | null
          created_at: string
          deleted_at: string | null
          fired_at: string | null
          id: string
          kind: string
          suspended_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_reminders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_reminders_restore: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          at: string | null
          created_at: string
          deleted_at: string | null
          fired_at: string | null
          id: string
          kind: string
          suspended_at: string | null
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_reminders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_reschedule: {
        Args: {
          p_days?: number | null
          p_scheduled_at: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_session_add: {
        Args: { p_session: Json | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_session_remove: {
        Args: { p_session_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_session_update: {
        Args: { p_patch: Json | null; p_session_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_set_status: {
        Args: {
          p_position?: string | null
          p_recurrence?: Json | null
          p_status: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_set_time_blocks: {
        Args: { p_blocks: Json | null; p_workspace_id: string | null }
        Returns: Json
      }
      tasks_op_skip_occurrence: {
        Args: {
          p_recurrence: Json | null
          p_release_commit?: boolean | null
          p_scheduled_at: string | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_tag: {
        Args: {
          p_add: string[] | null
          p_remove?: string[] | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: string[]
      }
      tasks_op_track_time: {
        Args: {
          p_action: string | null
          p_client_key?: string | null
          p_ended_at?: string | null
          p_entry_id?: string | null
          p_note?: string | null
          p_on?: string | null
          p_reason?: string | null
          p_run_id?: string | null
          p_seconds?: number | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      tasks_op_trash_purge: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      tasks_op_trash_restore: {
        Args: {
          p_entity_id: string | null
          p_entity_type: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      tasks_op_uncommit: {
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
        Args: { p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_update: {
        Args: { p_patch: Json | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_update_with: {
        Args: {
          p_patch: Json | null
          p_task_id: string | null
          p_with?: Json | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_op_waiting_add: {
        Args: { p_entry: Json | null; p_task_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          label: string | null
          ref: string | null
          since: string
          task_id: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_waiting"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_op_waiting_remove: {
        Args: { p_entry_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          label: string | null
          ref: string | null
          since: string
          task_id: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_waiting"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_queue__guard: {
        Args: {
          p_need_view?: boolean | null
          p_task_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          assignee_id: string | null
          bucket_id: string
          commit_order: number | null
          committed_for: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          creator_unknown: boolean
          deleted_at: string | null
          deleted_batch_id: string | null
          description: string
          due_date: string | null
          due_on: string | null
          due_time: string | null
          duration_minutes: number | null
          energy_level: string | null
          estimate_minutes: number | null
          id: string
          imported_from: Json | null
          number: number
          owner_id: string | null
          parent_id: string | null
          position: string
          priority: string | null
          recurrence: Json | null
          reschedule_count: number
          scheduled_at: string | null
          section_id: string | null
          status: string
          status_category: string
          status_id: string
          team_check_back_at: string | null
          team_id: string | null
          team_routed_at: string | null
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
      tasks_queue__key: { Args: { p_n: number | null }; Returns: string }
      tasks_queue__lock: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks_queue__mine: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: {
          id: string
          position: string
          queued_at: string
          task_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "task_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tasks_queue__num: { Args: { p_key: string | null }; Returns: number }
      tasks_queue__place: {
        Args: {
          p_after?: string | null
          p_task_id: string | null
          p_user: string | null
          p_where: string | null
          p_workspace_id: string | null
        }
        Returns: boolean
      }
      tasks_queue__renumber: {
        Args: { p_except: string | null; p_user: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      tasks_search: {
        Args: { p_limit?: number | null; p_query: string | null; p_workspace_id: string | null }
        Returns: string[]
      }
      tasks_time__answer: {
        Args: {
          p_entry_id: string | null
          p_status: string | null
          p_task_id: string | null
          p_user: string | null
        }
        Returns: Json
      }
      tasks_time__mine: {
        Args: { p_task_id: string | null; p_user: string | null }
        Returns: number
      }
      tasks_time__store_total: { Args: { p_task_id: string | null }; Returns: number }
      tasks_time__sum: { Args: { p_task_id: string | null }; Returns: number }
      tasks_time__total: { Args: { p_task_id: string | null }; Returns: number }
      tasks_time_report: {
        Args: {
          p_client_contact_id?: string | null
          p_from: string | null
          p_limit?: number | null
          p_project_ids?: string[] | null
          p_to: string | null
          p_workspace_id: string | null
          p_zone?: string | null
        }
        Returns: {
          entry_day: string
          entry_id: string
          is_mine: boolean
          kind: string
          note: string
          project_id: string
          project_is_inbox: boolean
          project_name: string
          reason: string
          seconds: number
          task_id: string
          task_title: string
          user_id: string
        }[]
      }
      tasks_time_totals: {
        Args: { p_since?: string | null; p_workspace_id: string | null }
        Returns: {
          my_seconds: number
          my_seconds_since: number
          my_waiting_seconds: number
          task_id: string
          total_seconds: number
        }[]
      }
      teams__add_member: {
        Args: {
          p_user: string | null
          t: Database["public"]["Tables"]["teams"]["Row"] | null
        }
        Returns: undefined
      }
      teams__auto_mark: { Args: { p_name: string | null }; Returns: string }
      teams__check_mark: { Args: { p_mark: string | null }; Returns: string }
      teams__check_name: {
        Args: { p_except: string | null; p_name: string | null; p_workspace_id: string | null }
        Returns: string
      }
      teams__check_project: {
        Args: { p_project: Json | null; p_workspace_id: string | null }
        Returns: string
      }
      teams__members_of: {
        Args: { p_team_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          team_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "team_members"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      teams__route_project: {
        Args: { p_team_id: string | null; p_workspace_id: string | null }
        Returns: string
      }
      teams_op_add_member: {
        Args: { p_team_id: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          team_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "team_members"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      teams_op_create: {
        Args: { p_team: Json | null; p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          default_project_id: string | null
          deleted_at: string | null
          id: string
          mark: string
          name: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      teams_op_remove_member: {
        Args: { p_team_id: string | null; p_user_id: string | null; p_workspace_id: string | null }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          team_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "team_members"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      teams_op_update: {
        Args: { p_patch: Json | null; p_team_id: string | null; p_workspace_id: string | null }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          default_project_id: string | null
          deleted_at: string | null
          id: string
          mark: string
          name: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      templates__bundle: {
        Args: { p_project_id: string | null; p_task_ids: string[] | null }
        Returns: Json
      }
      templates__can_take: {
        Args: { p_user: string | null; p_workspace_id: string | null }
        Returns: boolean
      }
      templates__check_body: {
        Args: { p_body: Json | null; p_kind: string | null }
        Returns: undefined
      }
      templates__create_tasks: {
        Args: {
          p_body: Json | null
          p_keep_people: boolean | null
          p_project_id: string | null
          p_root: Json | null
          p_section_ids: string[] | null
          p_start: string | null
          p_status_ids: string[] | null
          p_workspace_id: string | null
        }
        Returns: string[]
      }
      templates__int: {
        Args: { p_max: number | null; p_min: number | null; p_value: Json | null; p_what: string | null }
        Returns: number
      }
      templates__item_shared: {
        Args: { p_id: string | null; p_type: string | null }
        Returns: boolean
      }
      templates__offset: {
        Args: { p_anchor: string | null; p_date: string | null }
        Returns: number
      }
      templates__sources_full: {
        Args: { p_actor: string | null; p_kind: string | null; p_sources: string[] | null }
        Returns: boolean
      }
      templates__starter_body: { Args: { p_key: string | null }; Returns: Json }
      templates__starter_task: {
        Args: {
          p_due: number | null
          p_parent: number | null
          p_section: number | null
          p_status?: number | null
          p_title: string | null
        }
        Returns: Json
      }
      templates__summary: { Args: { p_body: Json | null }; Returns: Json }
      templates__task_entry: {
        Args: {
          p_actor: string | null
          p_anchor: string | null
          p_parent: number | null
          p_section: number | null
          p_status: number | null
          t: Database["public"]["Tables"]["tasks"]["Row"] | null
        }
        Returns: Json
      }
      templates__text: {
        Args: { p_max: number | null; p_value: Json | null; p_what: string | null }
        Returns: string
      }
      templates__usable: {
        Args: { p_kind: string | null; p_template_id: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      templates__uuid: {
        Args: { p_value: Json | null; p_what: string | null }
        Returns: string
      }
      templates__workspace_sees: {
        Args: { p_project_id: string | null }
        Returns: boolean
      }
      templates_can_copy: {
        Args: { p_id: string | null; p_kind: string | null }
        Returns: boolean
      }
      templates_op_update: {
        Args: {
          p_kind: string | null
          p_patch: Json | null
          p_template_id: string | null
          p_workspace_id: string | null
        }
        Returns: Json
      }
      time_region__quiet_now: {
        Args: { p_at: string | null; p_user: string | null }
        Returns: Record<string, unknown>
      }
      time_region__zone_ok: { Args: { p_zone: string | null }; Returns: boolean }
      user_agent_work: { Args: never; Returns: boolean }
      user_chat_prefs: { Args: never; Returns: Json }
      user_clients__purge: { Args: never; Returns: number }
      user_is_workspace_member: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      user_is_workspace_owner: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      user_op_clear_status: { Args: never; Returns: undefined }
      user_op_client_seen: {
        Args: { p_active?: boolean | null; p_client_id: string | null; p_surface: string | null }
        Returns: Json
      }
      user_op_forget_status: { Args: { p_id: string | null }; Returns: undefined }
      user_op_save_status: {
        Args: { p_id?: string | null; p_patch: Json | null }
        Returns: string
      }
      user_op_set_agent_work: { Args: { p_show: boolean | null }; Returns: boolean }
      user_op_set_chat_prefs: { Args: { p_patch: Json | null }; Returns: Json }
      user_op_set_status: { Args: { p_patch: Json | null }; Returns: Json }
      user_op_set_time_region: { Args: { p_patch: Json | null }; Returns: Json }
      user_op_set_time_zone: { Args: { p_time_zone: string | null }; Returns: string }
      user_statuses__expire: { Args: { p_now?: string | null }; Returns: number }
      user_statuses__json: {
        Args: {
          p_at: string | null
          p_row: Database["public"]["Tables"]["user_statuses"]["Row"] | null
        }
        Returns: Json
      }
      user_statuses__member: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      user_statuses__parts: {
        Args: { p_patch: Json | null; p_saved: boolean | null }
        Returns: {
          s_clear_after: string
          s_clear_at: string
          s_dnd: boolean
          s_emoji: string
          s_preset: string
          s_text: string
        }[]
      }
      user_statuses__rate: { Args: { p_user: string | null }; Returns: undefined }
      user_time_region: { Args: never; Returns: Json }
      waitlist__invite_blocker: { Args: { p_email: string | null }; Returns: string }
      waitlist__purge: { Args: never; Returns: number }
      waitlist__queue_invite: {
        Args: {
          p_dedupe_key: string | null
          p_email: string | null
          p_id: string | null
          p_joined_at: string | null
          p_source: string | null
        }
        Returns: string
      }
      waitlist_invite_email: { Args: { p_email: string | null }; Returns: string }
      waitlist_invite_next: {
        Args: { p_count?: number | null }
        Returns: {
          address: string
          outcome: string
        }[]
      }
      waitlist_join: {
        Args: {
          p_email: string | null
          p_ip_hash: string | null
          p_referrer?: string | null
          p_source: string | null
          p_updates?: boolean | null
          p_user_agent?: string | null
        }
        Returns: string
      }
      waitlist_resend_invite: { Args: { p_email: string | null }; Returns: string }
      workspace__email_person: { Args: { p_user: string | null }; Returns: Json }
      workspace__email_time: { Args: { p_at: string | null }; Returns: string }
      workspace__queue_member_email: {
        Args: {
          p_by_user: string | null
          p_kind: string | null
          p_to_user: string | null
          p_workspace_id: string | null
        }
        Returns: string
      }
      workspace_api_key_scopes_valid: {
        Args: { p_scopes: Json | null }
        Returns: boolean
      }
      workspace_api_keys__check_scopes: {
        Args: {
          p_can_widen: boolean | null
          p_creator: string | null
          p_current: Json | null
          p_next: Json | null
          p_workspace_id: string | null
        }
        Returns: undefined
      }
      workspace_api_keys_can_manage: {
        Args: { p_workspace_id: string | null }
        Returns: boolean
      }
      workspace_api_keys_connect_oauth: {
        Args: {
          p_authorization_id: string | null
          p_expires_in_days?: number | null
          p_include_private_chat?: boolean | null
          p_scopes?: Json | null
          p_workspace_id: string | null
        }
        Returns: {
          created: boolean
          expires_at: string
          id: string
          include_private_chat: boolean
          moved_from: string
          name: string
          scopes: Json
          workspace_id: string
        }[]
      }
      workspace_api_keys_create: {
        Args: {
          p_expires_in_days?: number | null
          p_name: string | null
          p_scopes?: Json | null
          p_workspace_id: string | null
        }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          key_prefix: string
          name: string
          scopes: Json
          secret: string
        }[]
      }
      workspace_api_keys_oauth_request: {
        Args: { p_authorization_id: string | null }
        Returns: Json
      }
      workspace_api_keys_rename: {
        Args: { p_key_id: string | null; p_name: string | null }
        Returns: string
      }
      workspace_api_keys_revoke: {
        Args: { p_key_id: string | null }
        Returns: undefined
      }
      workspace_api_keys_set_private_chat: {
        Args: { p_key_id: string | null; p_on: boolean | null }
        Returns: boolean
      }
      workspace_api_keys_set_scopes: {
        Args: { p_key_id: string | null; p_scopes: Json | null }
        Returns: Json
      }
      workspace_notice_pauses: { Args: never; Returns: Json }
      workspace_op_accept_invite: {
        Args: { p_token: string | null }
        Returns: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          permissions_notes: string
          permissions_tasks: string
          role: string
          role_id: string | null
          share_payload: Json
          status: string
          token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workspace_op_pause_notices: {
        Args: { p_paused: boolean | null; p_workspace_id: string | null }
        Returns: Json
      }
      workspace_op_remove_member: {
        Args: { p_member_id: string | null }
        Returns: undefined
      }
      workspace_op_role_delete: {
        Args: { p_reassign_to: string | null; p_role_id: string | null }
        Returns: undefined
      }
      workspace_op_role_upsert: {
        Args: {
          p_description: string | null
          p_expected_updated_at?: string | null
          p_name: string | null
          p_permissions: string[] | null
          p_read_only?: boolean | null
          p_role_id: string | null
          p_workspace_id: string | null
        }
        Returns: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          name: string
          permissions: string[]
          position: number
          read_only: boolean
          system_key: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_roles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workspace_op_set_member_access: {
        Args: { p_member_id: string | null; p_overrides?: Json | null; p_role_id: string | null }
        Returns: {
          id: string
          joined_at: string
          overrides: Json
          permissions_email: string | null
          permissions_notes: string
          permissions_tasks: string
          perms: string[]
          role: string
          role_id: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workspace_op_set_member_role: {
        Args: {
          p_member_id: string | null
          p_perm_notes?: string | null
          p_perm_tasks?: string | null
          p_role: string | null
        }
        Returns: undefined
      }
      workspace_op_set_task_key: {
        Args: { p_key: string | null; p_workspace_id: string | null }
        Returns: Json
      }
      workspace_op_transfer_ownership: {
        Args: { p_member_id: string | null }
        Returns: undefined
      }
      workspace_seat_cap: { Args: { p_owner: string | null }; Returns: number }
      workspace_seats_used: { Args: { p_workspace: string | null }; Returns: number }
      workspaces__default_task_key: {
        Args: { p_name: string | null }
        Returns: string
      }
      workspaces_owned_count_for_user: {
        Args: { p_user_id: string | null }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
