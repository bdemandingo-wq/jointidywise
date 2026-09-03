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
      abandoned_bookings: {
        Row: {
          converted: boolean | null
          converted_at: string | null
          created_at: string
          email: string | null
          first_name: string | null
          followup_sent: boolean | null
          followup_sent_at: string | null
          form_snapshot: Json | null
          id: string
          last_name: string | null
          organization_id: string
          phone: string | null
          service_id: string | null
          session_token: string
          sms_consent: boolean
          step_reached: number | null
          updated_at: string
        }
        Insert: {
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          followup_sent?: boolean | null
          followup_sent_at?: string | null
          form_snapshot?: Json | null
          id?: string
          last_name?: string | null
          organization_id: string
          phone?: string | null
          service_id?: string | null
          session_token: string
          sms_consent?: boolean
          step_reached?: number | null
          updated_at?: string
        }
        Update: {
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          followup_sent?: boolean | null
          followup_sent_at?: string | null
          form_snapshot?: Json | null
          id?: string
          last_name?: string | null
          organization_id?: string
          phone?: string | null
          service_id?: string | null
          session_token?: string
          sms_consent?: boolean
          step_reached?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abandoned_bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandoned_bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      abuse_throttle: {
        Row: {
          action: string
          bucket: string
          created_at: string
          id: number
        }
        Insert: {
          action: string
          bucket: string
          created_at?: string
          id?: number
        }
        Update: {
          action?: string
          bucket?: string
          created_at?: string
          id?: number
        }
        Relationships: []
      }
      access_code_redemptions: {
        Row: {
          access_code_id: string
          email: string | null
          id: string
          organization_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          access_code_id: string
          email?: string | null
          id?: string
          organization_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          access_code_id?: string
          email?: string | null
          id?: string
          organization_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_code_redemptions_access_code_id_fkey"
            columns: ["access_code_id"]
            isOneToOne: false
            referencedRelation: "access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_code_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      access_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          duration_days: number
          email_lock: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          reason: string | null
          uses: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          duration_days: number
          email_lock?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          reason?: string | null
          uses?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          email_lock?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          reason?: string | null
          uses?: number
        }
        Relationships: []
      }
      account_deletion_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          organization_name: string | null
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          organization_name?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          organization_name?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
        }
        Relationships: []
      }
      ad_management_requests: {
        Row: {
          business_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          has_ad_accounts: boolean | null
          id: string
          monthly_budget: number | null
          notes: string | null
          organization_id: string
          service_area: string | null
          service_type: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          business_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          has_ad_accounts?: boolean | null
          id?: string
          monthly_budget?: number | null
          notes?: string | null
          organization_id: string
          service_area?: string | null
          service_type: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          business_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          has_ad_accounts?: boolean | null
          id?: string
          monthly_budget?: number | null
          notes?: string | null
          organization_id?: string
          service_area?: string | null
          service_type?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_management_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_management_subscriptions: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          id: string
          monthly_amount_cents: number
          organization_id: string
          platform: string
          started_at: string
          status: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          monthly_amount_cents?: number
          organization_id: string
          platform: string
          started_at?: string
          status?: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          monthly_amount_cents?: number
          organization_id?: string
          platform?: string
          started_at?: string
          status?: string
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_management_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      additional_charges: {
        Row: {
          booking_id: string
          charge_amount: number
          charge_name: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          organization_id: string | null
        }
        Insert: {
          booking_id: string
          charge_amount: number
          charge_name: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
        }
        Update: {
          booking_id?: string
          charge_amount?: number
          charge_name?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "additional_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_action_audit_log: {
        Row: {
          action: string
          admin_user_id: string | null
          created_at: string
          details: Json | null
          id: string
          organization_id: string
          payment_intent_id: string | null
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id: string
          payment_intent_id?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id?: string
          payment_intent_id?: string | null
        }
        Relationships: []
      }
      admin_booking_request_notifications: {
        Row: {
          booking_request_id: string
          created_at: string
          id: string
          is_read: boolean | null
          organization_id: string
        }
        Insert: {
          booking_request_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          organization_id: string
        }
        Update: {
          booking_request_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_booking_request_notifications_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "client_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_booking_request_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_chat_conversations: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          image_url: string | null
          organization_id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "admin_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_chat_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_system_notifications: {
        Row: {
          created_at: string
          dedupe_key: string | null
          id: string
          is_read: boolean
          link: string | null
          message: string
          metadata: Json
          organization_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          metadata?: Json
          organization_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          metadata?: Json
          organization_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_system_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_calculation_log: {
        Row: {
          calculation_type: string
          completed_at: string | null
          error_message: string | null
          id: string
          organization_id: string
          records_processed: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          calculation_type: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          records_processed?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          calculation_type?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          records_processed?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_calculation_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_ledger: {
        Row: {
          balance: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_ledger_entries: {
        Row: {
          created_at: string
          delta: number
          id: string
          organization_id: string
          reason: string
          stripe_session_id: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          organization_id: string
          reason: string
          stripe_session_id?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          organization_id?: string
          reason?: string
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_ledger_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_processed_sessions: {
        Row: {
          credits: number
          organization_id: string
          processed_at: string
          stripe_session_id: string
        }
        Insert: {
          credits: number
          organization_id: string
          processed_at?: string
          stripe_session_id: string
        }
        Update: {
          credits?: number
          organization_id?: string
          processed_at?: string
          stripe_session_id?: string
        }
        Relationships: []
      }
      ai_rate_limits: {
        Row: {
          created_at: string
          id: string
          request_count: number
          scope: string
          scope_id: string
          updated_at: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          request_count?: number
          scope: string
          scope_id: string
          updated_at?: string
          window_seconds: number
          window_start: string
        }
        Update: {
          created_at?: string
          id?: string
          request_count?: number
          scope?: string
          scope_id?: string
          updated_at?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
      ai_reply_locks: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          organization_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          organization_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reply_locks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reply_log: {
        Row: {
          created_at: string | null
          inbound_message_id: string
        }
        Insert: {
          created_at?: string | null
          inbound_message_id: string
        }
        Update: {
          created_at?: string | null
          inbound_message_id?: string
        }
        Relationships: []
      }
      ai_usage_daily: {
        Row: {
          credits_used: number
          organization_id: string
          updated_at: string
          usage_date: string
        }
        Insert: {
          credits_used?: number
          organization_id: string
          updated_at?: string
          usage_date: string
        }
        Update: {
          credits_used?: number
          organization_id?: string
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminder_intervals: {
        Row: {
          created_at: string
          hours_before: number
          id: string
          is_active: boolean
          label: string
          organization_id: string
          send_to_cleaner: boolean
          send_to_client: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          hours_before: number
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          send_to_cleaner?: boolean
          send_to_client?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          hours_before?: number
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          send_to_cleaner?: boolean
          send_to_client?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminder_intervals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_campaigns: {
        Row: {
          body: string
          created_at: string
          days_inactive: number | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          organization_id: string | null
          scheduled_at: string | null
          subject: string
          throttle_seconds: number
          type: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          days_inactive?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          organization_id?: string | null
          scheduled_at?: string | null
          subject: string
          throttle_seconds?: number
          type: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          days_inactive?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          organization_id?: string | null
          scheduled_at?: string | null
          subject?: string
          throttle_seconds?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automated_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_review_sms_queue: {
        Row: {
          booking_id: string
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          organization_id: string
          send_at: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          organization_id: string
          send_at: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          organization_id?: string
          send_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automated_review_sms_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_review_sms_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_definitions: {
        Row: {
          automation_key: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          automation_key: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          automation_key?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_fire_log: {
        Row: {
          automation_type: string
          fired_at: string
          id: string
          metadata: Json
          organization_id: string
          target_id: string
        }
        Insert: {
          automation_type: string
          fired_at?: string
          id?: string
          metadata?: Json
          organization_id: string
          target_id: string
        }
        Update: {
          automation_type?: string
          fired_at?: string
          id?: string
          metadata?: Json
          organization_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_fire_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_steps: {
        Row: {
          automation_id: string
          channel: string
          created_at: string
          direction: string
          email_body: string
          email_subject: string
          enabled: boolean
          id: string
          label: string
          offset_minutes: number | null
          offset_unit: string
          offset_value: number
          organization_id: string
          position: number
          recipient_cleaner: boolean
          recipient_client: boolean
          recipient_owner: boolean
          sms_body: string
          updated_at: string
        }
        Insert: {
          automation_id: string
          channel?: string
          created_at?: string
          direction?: string
          email_body?: string
          email_subject?: string
          enabled?: boolean
          id?: string
          label: string
          offset_minutes?: number | null
          offset_unit?: string
          offset_value?: number
          organization_id: string
          position?: number
          recipient_cleaner?: boolean
          recipient_client?: boolean
          recipient_owner?: boolean
          sms_body?: string
          updated_at?: string
        }
        Update: {
          automation_id?: string
          channel?: string
          created_at?: string
          direction?: string
          email_body?: string
          email_subject?: string
          enabled?: boolean
          id?: string
          label?: string
          offset_minutes?: number | null
          offset_unit?: string
          offset_value?: number
          organization_id?: string
          position?: number
          recipient_cleaner?: boolean
          recipient_client?: boolean
          recipient_owner?: boolean
          sms_body?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_steps_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_triggers: {
        Row: {
          automation_id: string
          created_at: string
          direction: string | null
          id: string
          meta: Json
          offset_unit: string | null
          offset_value: number | null
          organization_id: string
          trigger_key: string
        }
        Insert: {
          automation_id: string
          created_at?: string
          direction?: string | null
          id?: string
          meta?: Json
          offset_unit?: string | null
          offset_value?: number | null
          organization_id: string
          trigger_key: string
        }
        Update: {
          automation_id?: string
          created_at?: string
          direction?: string | null
          id?: string
          meta?: Json
          offset_unit?: string | null
          offset_value?: number | null
          organization_id?: string
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_triggers_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_audit_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          event_type: string
          id: string
          metadata: Json
          organization_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          event_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          status: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_backfill_jobs: {
        Row: {
          created_at: string
          cursor_after: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          objects_seen: number
          pages_done: number
          resource: string
          rows_written: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cursor_after?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          objects_seen?: number
          pages_done?: number
          resource: string
          rows_written?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cursor_after?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          objects_seen?: number
          pages_done?: number
          resource?: string
          rows_written?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          amount_cents: number
          corrected_at: string | null
          correction_basis: string | null
          correction_confidence: string | null
          counts_as_cash: boolean
          currency: string
          customer_email: string | null
          description: string | null
          event_type: string
          fee_cents: number | null
          id: string
          is_proration: boolean
          net_cents: number | null
          occurred_at: string
          organization_id: string | null
          organization_name: string | null
          raw: Json
          revenue_stream: string
          revenue_stream_corrected: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_object_id: string
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          synced_at: string
        }
        Insert: {
          amount_cents: number
          corrected_at?: string | null
          correction_basis?: string | null
          correction_confidence?: string | null
          counts_as_cash?: boolean
          currency?: string
          customer_email?: string | null
          description?: string | null
          event_type: string
          fee_cents?: number | null
          id?: string
          is_proration?: boolean
          net_cents?: number | null
          occurred_at: string
          organization_id?: string | null
          organization_name?: string | null
          raw?: Json
          revenue_stream: string
          revenue_stream_corrected?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_object_id: string
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          synced_at?: string
        }
        Update: {
          amount_cents?: number
          corrected_at?: string | null
          correction_basis?: string | null
          correction_confidence?: string | null
          counts_as_cash?: boolean
          currency?: string
          customer_email?: string | null
          description?: string | null
          event_type?: string
          fee_cents?: number | null
          id?: string
          is_proration?: boolean
          net_cents?: number | null
          occurred_at?: string
          organization_id?: string | null
          organization_name?: string | null
          raw?: Json
          revenue_stream?: string
          revenue_stream_corrected?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_object_id?: string
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subscription_periods: {
        Row: {
          billing_interval: string
          cancellation_detail: string | null
          cancellation_reason: string | null
          currency: string
          customer_email: string | null
          discount_amount_cents: number | null
          discount_percent: number | null
          effective_from: string
          effective_to: string | null
          id: string
          interval_count: number
          organization_id: string | null
          organization_name: string | null
          plan_label: string | null
          quantity: number
          raw: Json
          revenue_stream: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string
          synced_at: string
          unit_amount_cents: number
        }
        Insert: {
          billing_interval: string
          cancellation_detail?: string | null
          cancellation_reason?: string | null
          currency?: string
          customer_email?: string | null
          discount_amount_cents?: number | null
          discount_percent?: number | null
          effective_from: string
          effective_to?: string | null
          id?: string
          interval_count?: number
          organization_id?: string | null
          organization_name?: string | null
          plan_label?: string | null
          quantity?: number
          raw?: Json
          revenue_stream: string
          status: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id: string
          synced_at?: string
          unit_amount_cents: number
        }
        Update: {
          billing_interval?: string
          cancellation_detail?: string | null
          cancellation_reason?: string | null
          currency?: string
          customer_email?: string | null
          discount_amount_cents?: number | null
          discount_percent?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          interval_count?: number
          organization_id?: string | null
          organization_name?: string | null
          plan_label?: string | null
          quantity?: number
          raw?: Json
          revenue_stream?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string
          synced_at?: string
          unit_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscription_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_keyword_queue: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          generated_post_id: string | null
          id: string
          intent: string | null
          keyword: string
          last_attempted_at: string | null
          opportunity: string | null
          priority: number
          search_volume: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          generated_post_id?: string | null
          id?: string
          intent?: string | null
          keyword: string
          last_attempted_at?: string | null
          opportunity?: string | null
          priority?: number
          search_volume?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          generated_post_id?: string | null
          id?: string
          intent?: string | null
          keyword?: string
          last_attempted_at?: string | null
          opportunity?: string | null
          priority?: number
          search_volume?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_keyword_queue_generated_post_id_fkey"
            columns: ["generated_post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          ai_model_used: string | null
          approved_at: string | null
          approved_by: string | null
          author: string
          category: string
          content: string
          created_at: string
          excerpt: string
          featured_image_url: string | null
          generation_prompt: string | null
          id: string
          internal_links: Json | null
          is_featured: boolean
          is_published: boolean
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          quality_notes: string | null
          quality_score: number | null
          read_time: string
          secondary_keywords: string[] | null
          slug: string
          status: string
          target_keyword: string | null
          title: string
          updated_at: string
          word_count: number | null
        }
        Insert: {
          ai_model_used?: string | null
          approved_at?: string | null
          approved_by?: string | null
          author?: string
          category?: string
          content: string
          created_at?: string
          excerpt: string
          featured_image_url?: string | null
          generation_prompt?: string | null
          id?: string
          internal_links?: Json | null
          is_featured?: boolean
          is_published?: boolean
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          quality_notes?: string | null
          quality_score?: number | null
          read_time?: string
          secondary_keywords?: string[] | null
          slug: string
          status?: string
          target_keyword?: string | null
          title: string
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          ai_model_used?: string | null
          approved_at?: string | null
          approved_by?: string | null
          author?: string
          category?: string
          content?: string
          created_at?: string
          excerpt?: string
          featured_image_url?: string | null
          generation_prompt?: string | null
          id?: string
          internal_links?: Json | null
          is_featured?: boolean
          is_published?: boolean
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          quality_notes?: string | null
          quality_score?: number | null
          read_time?: string
          secondary_keywords?: string[] | null
          slug?: string
          status?: string
          target_keyword?: string | null
          title?: string
          updated_at?: string
          word_count?: number | null
        }
        Relationships: []
      }
      booking_checkins: {
        Row: {
          address_match: boolean | null
          booking_id: string | null
          checkin_type: string
          created_at: string | null
          distance_meters: number | null
          id: string
          latitude: number | null
          longitude: number | null
          organization_id: string
          staff_id: string | null
        }
        Insert: {
          address_match?: boolean | null
          booking_id?: string | null
          checkin_type: string
          created_at?: string | null
          distance_meters?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          organization_id: string
          staff_id?: string | null
        }
        Update: {
          address_match?: boolean | null
          booking_id?: string | null
          checkin_type?: string
          created_at?: string | null
          distance_meters?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          organization_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_checkins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checkins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checkins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_checklist_items: {
        Row: {
          booking_checklist_id: string
          checklist_item_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean | null
          notes: string | null
          organization_id: string | null
          photo_url: string | null
          title: string
        }
        Insert: {
          booking_checklist_id: string
          checklist_item_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean | null
          notes?: string | null
          organization_id?: string | null
          photo_url?: string | null
          title: string
        }
        Update: {
          booking_checklist_id?: string
          checklist_item_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean | null
          notes?: string | null
          organization_id?: string | null
          photo_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_checklist_items_booking_checklist_id_fkey"
            columns: ["booking_checklist_id"]
            isOneToOne: false
            referencedRelation: "booking_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklist_items_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_checklists: {
        Row: {
          booking_id: string
          completed_at: string | null
          created_at: string
          id: string
          organization_id: string | null
          staff_id: string | null
          template_id: string | null
        }
        Insert: {
          booking_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string | null
          staff_id?: string | null
          template_id?: string | null
        }
        Update: {
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string | null
          staff_id?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_checklists_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklists_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklists_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklists_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_link_tracking: {
        Row: {
          booking_completed_at: string | null
          campaign_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          link_opened_at: string | null
          link_sent_at: string
          link_type: string
          organization_id: string
          status: string
          tracking_ref: string
          updated_at: string
        }
        Insert: {
          booking_completed_at?: string | null
          campaign_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          link_opened_at?: string | null
          link_sent_at?: string
          link_type?: string
          organization_id: string
          status?: string
          tracking_ref: string
          updated_at?: string
        }
        Update: {
          booking_completed_at?: string | null
          campaign_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          link_opened_at?: string | null
          link_sent_at?: string
          link_type?: string
          organization_id?: string
          status?: string
          tracking_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_link_tracking_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "automated_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_link_tracking_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_link_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_photos: {
        Row: {
          booking_id: string
          caption: string | null
          created_at: string | null
          id: string
          inspection_note: string | null
          issue_category: string | null
          media_type: string
          organization_id: string | null
          photo_type: string | null
          photo_url: string
          staff_id: string | null
        }
        Insert: {
          booking_id: string
          caption?: string | null
          created_at?: string | null
          id?: string
          inspection_note?: string | null
          issue_category?: string | null
          media_type?: string
          organization_id?: string | null
          photo_type?: string | null
          photo_url: string
          staff_id?: string | null
        }
        Update: {
          booking_id?: string
          caption?: string | null
          created_at?: string | null
          id?: string
          inspection_note?: string | null
          issue_category?: string | null
          media_type?: string
          organization_id?: string | null
          photo_type?: string | null
          photo_url?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_photos_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_photos_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_photos_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reminder_log: {
        Row: {
          booking_id: string
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          recipient_phone: string
          reminder_type: string
          sent_at: string
          status: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          recipient_phone: string
          reminder_type: string
          sent_at?: string
          status?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          recipient_phone?: string
          reminder_type?: string
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_reminder_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reminder_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_submission_failures: {
        Row: {
          client_ip: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          organization_id: string | null
          organization_slug: string | null
          origin: string | null
          path: string
          payload: Json
          phone: string | null
          reason: string | null
          stage: string
          user_agent: string | null
        }
        Insert: {
          client_ip?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          organization_id?: string | null
          organization_slug?: string | null
          origin?: string | null
          path?: string
          payload?: Json
          phone?: string | null
          reason?: string | null
          stage: string
          user_agent?: string | null
        }
        Update: {
          client_ip?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          organization_id?: string | null
          organization_slug?: string | null
          origin?: string | null
          path?: string
          payload?: Json
          phone?: string | null
          reason?: string | null
          stage?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_submission_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_team_assignments: {
        Row: {
          booking_id: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          organization_id: string | null
          pay_share: number | null
          staff_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          organization_id?: string | null
          pay_share?: number | null
          staff_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          organization_id?: string | null
          pay_share?: number | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_team_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_team_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_team_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_team_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          actual_hours_worked: number | null
          address: string | null
          ai_converted: boolean | null
          ai_source_conversation_id: string | null
          apt_suite: string | null
          arrival_window_end: string | null
          arrival_window_start: string | null
          bathrooms: string | null
          bedrooms: string | null
          booking_number: number
          cancellation_category: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          city: string | null
          cleaner_actual_payment: number | null
          cleaner_checkin_at: string | null
          cleaner_checkin_lat: number | null
          cleaner_checkin_lng: number | null
          cleaner_checkout_at: string | null
          cleaner_override_hours: number | null
          cleaner_pay_expected: number | null
          cleaner_wage: number | null
          cleaner_wage_type: string | null
          completed_at: string | null
          completed_at_source: string | null
          created_at: string
          custom_frequency_days: number | null
          customer_id: string | null
          customer_notes: string | null
          deposit_paid: number | null
          discount_amount: number | null
          discount_id: string | null
          duration: number
          extras: Json | null
          frequency: string | null
          has_pets: boolean
          hours_basis: string | null
          hours_capped_at: number | null
          id: string
          is_arrival_window: boolean
          is_draft: boolean | null
          is_test: boolean | null
          latitude: number | null
          location_id: string | null
          longitude: number | null
          loyalty_tier: string | null
          notes: string | null
          organization_id: string | null
          original_scheduled_at: string | null
          pay_base_amount: number | null
          pay_base_mode: string | null
          pay_last_saved_at: string | null
          pay_last_saved_by: string | null
          pay_locked: boolean | null
          payment_intent_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          payroll_date: string | null
          payroll_locked_week: string | null
          payroll_needs_review: boolean
          previous_scheduled_at: string | null
          recurring_booking_id: string | null
          recurring_days_of_week: number[] | null
          referral_code: string | null
          referral_id: string | null
          reschedule_reason: string | null
          rescheduled_at: string | null
          rescheduled_by: string | null
          room_reductions: Json | null
          scheduled_at: string
          service_id: string | null
          square_footage: string | null
          staff_id: string | null
          state: string | null
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number | null
          tax_amount: number | null
          total_amount: number
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          actual_hours_worked?: number | null
          address?: string | null
          ai_converted?: boolean | null
          ai_source_conversation_id?: string | null
          apt_suite?: string | null
          arrival_window_end?: string | null
          arrival_window_start?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          booking_number?: number
          cancellation_category?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          city?: string | null
          cleaner_actual_payment?: number | null
          cleaner_checkin_at?: string | null
          cleaner_checkin_lat?: number | null
          cleaner_checkin_lng?: number | null
          cleaner_checkout_at?: string | null
          cleaner_override_hours?: number | null
          cleaner_pay_expected?: number | null
          cleaner_wage?: number | null
          cleaner_wage_type?: string | null
          completed_at?: string | null
          completed_at_source?: string | null
          created_at?: string
          custom_frequency_days?: number | null
          customer_id?: string | null
          customer_notes?: string | null
          deposit_paid?: number | null
          discount_amount?: number | null
          discount_id?: string | null
          duration: number
          extras?: Json | null
          frequency?: string | null
          has_pets?: boolean
          hours_basis?: string | null
          hours_capped_at?: number | null
          id?: string
          is_arrival_window?: boolean
          is_draft?: boolean | null
          is_test?: boolean | null
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          loyalty_tier?: string | null
          notes?: string | null
          organization_id?: string | null
          original_scheduled_at?: string | null
          pay_base_amount?: number | null
          pay_base_mode?: string | null
          pay_last_saved_at?: string | null
          pay_last_saved_by?: string | null
          pay_locked?: boolean | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          payroll_date?: string | null
          payroll_locked_week?: string | null
          payroll_needs_review?: boolean
          previous_scheduled_at?: string | null
          recurring_booking_id?: string | null
          recurring_days_of_week?: number[] | null
          referral_code?: string | null
          referral_id?: string | null
          reschedule_reason?: string | null
          rescheduled_at?: string | null
          rescheduled_by?: string | null
          room_reductions?: Json | null
          scheduled_at: string
          service_id?: string | null
          square_footage?: string | null
          staff_id?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          actual_hours_worked?: number | null
          address?: string | null
          ai_converted?: boolean | null
          ai_source_conversation_id?: string | null
          apt_suite?: string | null
          arrival_window_end?: string | null
          arrival_window_start?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          booking_number?: number
          cancellation_category?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          city?: string | null
          cleaner_actual_payment?: number | null
          cleaner_checkin_at?: string | null
          cleaner_checkin_lat?: number | null
          cleaner_checkin_lng?: number | null
          cleaner_checkout_at?: string | null
          cleaner_override_hours?: number | null
          cleaner_pay_expected?: number | null
          cleaner_wage?: number | null
          cleaner_wage_type?: string | null
          completed_at?: string | null
          completed_at_source?: string | null
          created_at?: string
          custom_frequency_days?: number | null
          customer_id?: string | null
          customer_notes?: string | null
          deposit_paid?: number | null
          discount_amount?: number | null
          discount_id?: string | null
          duration?: number
          extras?: Json | null
          frequency?: string | null
          has_pets?: boolean
          hours_basis?: string | null
          hours_capped_at?: number | null
          id?: string
          is_arrival_window?: boolean
          is_draft?: boolean | null
          is_test?: boolean | null
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          loyalty_tier?: string | null
          notes?: string | null
          organization_id?: string | null
          original_scheduled_at?: string | null
          pay_base_amount?: number | null
          pay_base_mode?: string | null
          pay_last_saved_at?: string | null
          pay_last_saved_by?: string | null
          pay_locked?: boolean | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          payroll_date?: string | null
          payroll_locked_week?: string | null
          payroll_needs_review?: boolean
          previous_scheduled_at?: string | null
          recurring_booking_id?: string | null
          recurring_days_of_week?: number[] | null
          referral_code?: string | null
          referral_id?: string | null
          reschedule_reason?: string | null
          rescheduled_at?: string | null
          rescheduled_by?: string | null
          room_reductions?: Json | null
          scheduled_at?: string
          service_id?: string | null
          square_footage?: string | null
          staff_id?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_recurring_booking_id_fkey"
            columns: ["recurring_booking_id"]
            isOneToOne: false
            referencedRelation: "recurring_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          attempts: number
          broadcast_id: string
          created_at: string
          email: string
          error_message: string | null
          id: string
          organization_id: string
          provider_message_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          broadcast_id: string
          created_at?: string
          email: string
          error_message?: string | null
          id?: string
          organization_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          broadcast_id?: string
          created_at?: string
          email?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_resolved_at: string | null
          body_text: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          last_test_sent_at: string | null
          message_class: string
          recipient_count: number
          sent_count: number
          signature_text: string | null
          skipped_count: number
          started_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience_resolved_at?: string | null
          body_text: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          last_test_sent_at?: string | null
          message_class: string
          recipient_count?: number
          sent_count?: number
          signature_text?: string | null
          skipped_count?: number
          started_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          audience_resolved_at?: string | null
          body_text?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          last_test_sent_at?: string | null
          message_class?: string
          recipient_count?: number
          sent_count?: number
          signature_text?: string | null
          skipped_count?: number
          started_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      business_intelligence: {
        Row: {
          avg_lead_conversion_rate: number | null
          best_converting_day: string | null
          best_converting_source: string | null
          best_converting_time: string | null
          bookings_needed_for_goal: number | null
          created_at: string | null
          id: string
          last_calculated_at: string | null
          optimal_price_range_high: number | null
          optimal_price_range_low: number | null
          optimal_response_window_minutes: number | null
          organization_id: string
          peak_demand_periods: Json | null
          predicted_monthly_revenue: number | null
          price_win_rate: number | null
          recommendations: Json | null
          revenue_goal_probability: number | null
          seasonal_factors: Json | null
          top_insights: Json | null
          updated_at: string | null
        }
        Insert: {
          avg_lead_conversion_rate?: number | null
          best_converting_day?: string | null
          best_converting_source?: string | null
          best_converting_time?: string | null
          bookings_needed_for_goal?: number | null
          created_at?: string | null
          id?: string
          last_calculated_at?: string | null
          optimal_price_range_high?: number | null
          optimal_price_range_low?: number | null
          optimal_response_window_minutes?: number | null
          organization_id: string
          peak_demand_periods?: Json | null
          predicted_monthly_revenue?: number | null
          price_win_rate?: number | null
          recommendations?: Json | null
          revenue_goal_probability?: number | null
          seasonal_factors?: Json | null
          top_insights?: Json | null
          updated_at?: string | null
        }
        Update: {
          avg_lead_conversion_rate?: number | null
          best_converting_day?: string | null
          best_converting_source?: string | null
          best_converting_time?: string | null
          bookings_needed_for_goal?: number | null
          created_at?: string | null
          id?: string
          last_calculated_at?: string | null
          optimal_price_range_high?: number | null
          optimal_price_range_low?: number | null
          optimal_response_window_minutes?: number | null
          organization_id?: string
          peak_demand_periods?: Json | null
          predicted_monthly_revenue?: number | null
          price_win_rate?: number | null
          recommendations?: Json | null
          revenue_goal_probability?: number | null
          seasonal_factors?: Json | null
          top_insights?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_intelligence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          accent_color: string | null
          allow_online_booking: boolean | null
          app_url: string | null
          arrival_windows: Json
          benchmarks_opt_in: boolean
          booking_buffer_minutes: number | null
          campaign_quiet_hours_enabled: boolean
          campaign_quiet_hours_end: number
          campaign_quiet_hours_start: number
          cancellation_policy: string | null
          cancellation_window_hours: number | null
          company_address: string | null
          company_city: string | null
          company_email: string | null
          company_name: string
          company_phone: string | null
          company_state: string | null
          company_zip: string | null
          confirmation_email_body: string | null
          confirmation_email_sections: Json | null
          confirmation_email_subject: string | null
          created_at: string
          currency: string | null
          google_analytics_id: string | null
          google_review_url: string | null
          id: string
          invoice_footer_message: string | null
          invoice_header_layout: string | null
          logo_url: string | null
          max_advance_booking_days: number | null
          meta_pixel_id: string | null
          min_clockout_photos: number
          minimum_notice_hours: number | null
          notify_cancellations: boolean | null
          notify_evening_brief: boolean
          notify_morning_brief: boolean
          notify_new_booking: boolean | null
          notify_reminders: boolean | null
          notify_sms: boolean | null
          organization_id: string | null
          payroll_custom_days: number[] | null
          payroll_frequency: string
          payroll_report_email_enabled: boolean
          payroll_report_recipients: string[]
          payroll_report_send_day: number | null
          payroll_report_send_hour: number
          payroll_start_day: number
          primary_color: string | null
          recurring_discount_biweekly: number
          recurring_discount_monthly: number
          recurring_discount_one_time: number
          recurring_discount_weekly: number
          reminder_email_body: string | null
          reminder_email_sections: Json | null
          reminder_email_subject: string | null
          require_cleaner_payout_setup: boolean
          require_clockout_photos: boolean
          require_deposit: boolean | null
          resend_api_key: string | null
          review_sms_template: string | null
          scheduling_mode: string
          surge_holiday_enabled: boolean
          surge_holiday_multiplier: number
          surge_lastminute_enabled: boolean
          surge_lastminute_hours: number
          surge_lastminute_multiplier: number
          surge_weekend_enabled: boolean
          surge_weekend_multiplier: number
          timezone: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          accent_color?: string | null
          allow_online_booking?: boolean | null
          app_url?: string | null
          arrival_windows?: Json
          benchmarks_opt_in?: boolean
          booking_buffer_minutes?: number | null
          campaign_quiet_hours_enabled?: boolean
          campaign_quiet_hours_end?: number
          campaign_quiet_hours_start?: number
          cancellation_policy?: string | null
          cancellation_window_hours?: number | null
          company_address?: string | null
          company_city?: string | null
          company_email?: string | null
          company_name?: string
          company_phone?: string | null
          company_state?: string | null
          company_zip?: string | null
          confirmation_email_body?: string | null
          confirmation_email_sections?: Json | null
          confirmation_email_subject?: string | null
          created_at?: string
          currency?: string | null
          google_analytics_id?: string | null
          google_review_url?: string | null
          id?: string
          invoice_footer_message?: string | null
          invoice_header_layout?: string | null
          logo_url?: string | null
          max_advance_booking_days?: number | null
          meta_pixel_id?: string | null
          min_clockout_photos?: number
          minimum_notice_hours?: number | null
          notify_cancellations?: boolean | null
          notify_evening_brief?: boolean
          notify_morning_brief?: boolean
          notify_new_booking?: boolean | null
          notify_reminders?: boolean | null
          notify_sms?: boolean | null
          organization_id?: string | null
          payroll_custom_days?: number[] | null
          payroll_frequency?: string
          payroll_report_email_enabled?: boolean
          payroll_report_recipients?: string[]
          payroll_report_send_day?: number | null
          payroll_report_send_hour?: number
          payroll_start_day?: number
          primary_color?: string | null
          recurring_discount_biweekly?: number
          recurring_discount_monthly?: number
          recurring_discount_one_time?: number
          recurring_discount_weekly?: number
          reminder_email_body?: string | null
          reminder_email_sections?: Json | null
          reminder_email_subject?: string | null
          require_cleaner_payout_setup?: boolean
          require_clockout_photos?: boolean
          require_deposit?: boolean | null
          resend_api_key?: string | null
          review_sms_template?: string | null
          scheduling_mode?: string
          surge_holiday_enabled?: boolean
          surge_holiday_multiplier?: number
          surge_lastminute_enabled?: boolean
          surge_lastminute_hours?: number
          surge_lastminute_multiplier?: number
          surge_weekend_enabled?: boolean
          surge_weekend_multiplier?: number
          timezone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          accent_color?: string | null
          allow_online_booking?: boolean | null
          app_url?: string | null
          arrival_windows?: Json
          benchmarks_opt_in?: boolean
          booking_buffer_minutes?: number | null
          campaign_quiet_hours_enabled?: boolean
          campaign_quiet_hours_end?: number
          campaign_quiet_hours_start?: number
          cancellation_policy?: string | null
          cancellation_window_hours?: number | null
          company_address?: string | null
          company_city?: string | null
          company_email?: string | null
          company_name?: string
          company_phone?: string | null
          company_state?: string | null
          company_zip?: string | null
          confirmation_email_body?: string | null
          confirmation_email_sections?: Json | null
          confirmation_email_subject?: string | null
          created_at?: string
          currency?: string | null
          google_analytics_id?: string | null
          google_review_url?: string | null
          id?: string
          invoice_footer_message?: string | null
          invoice_header_layout?: string | null
          logo_url?: string | null
          max_advance_booking_days?: number | null
          meta_pixel_id?: string | null
          min_clockout_photos?: number
          minimum_notice_hours?: number | null
          notify_cancellations?: boolean | null
          notify_evening_brief?: boolean
          notify_morning_brief?: boolean
          notify_new_booking?: boolean | null
          notify_reminders?: boolean | null
          notify_sms?: boolean | null
          organization_id?: string | null
          payroll_custom_days?: number[] | null
          payroll_frequency?: string
          payroll_report_email_enabled?: boolean
          payroll_report_recipients?: string[]
          payroll_report_send_day?: number | null
          payroll_report_send_hour?: number
          payroll_start_day?: number
          primary_color?: string | null
          recurring_discount_biweekly?: number
          recurring_discount_monthly?: number
          recurring_discount_one_time?: number
          recurring_discount_weekly?: number
          reminder_email_body?: string | null
          reminder_email_sections?: Json | null
          reminder_email_subject?: string | null
          require_cleaner_payout_setup?: boolean
          require_clockout_photos?: boolean
          require_deposit?: boolean | null
          resend_api_key?: string | null
          review_sms_template?: string | null
          scheduling_mode?: string
          surge_holiday_enabled?: boolean
          surge_holiday_multiplier?: number
          surge_lastminute_enabled?: boolean
          surge_lastminute_hours?: number
          surge_lastminute_multiplier?: number
          surge_weekend_enabled?: boolean
          surge_weekend_multiplier?: number
          timezone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_emails: {
        Row: {
          campaign_id: string | null
          clicked_at: string | null
          customer_id: string | null
          email: string
          id: string
          opened_at: string | null
          organization_id: string | null
          sent_at: string
          status: string
        }
        Insert: {
          campaign_id?: string | null
          clicked_at?: string | null
          customer_id?: string | null
          email: string
          id?: string
          opened_at?: string | null
          organization_id?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          campaign_id?: string | null
          clicked_at?: string | null
          customer_id?: string | null
          email?: string
          id?: string
          opened_at?: string | null
          organization_id?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "automated_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_emails_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_runs: {
        Row: {
          campaign_id: string
          cancel_reason: string | null
          completed_at: string | null
          created_at: string
          expires_at: string
          failed_count: number
          id: string
          next_send_at: string | null
          organization_id: string
          paused_at: string | null
          scheduled_at: string | null
          sent_count: number
          skipped_opted_out_count: number
          started_at: string | null
          status: string
          throttle_seconds: number
          total_recipients: number
        }
        Insert: {
          campaign_id: string
          cancel_reason?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at: string
          failed_count?: number
          id?: string
          next_send_at?: string | null
          organization_id: string
          paused_at?: string | null
          scheduled_at?: string | null
          sent_count?: number
          skipped_opted_out_count?: number
          started_at?: string | null
          status?: string
          throttle_seconds?: number
          total_recipients?: number
        }
        Update: {
          campaign_id?: string
          cancel_reason?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          failed_count?: number
          id?: string
          next_send_at?: string | null
          organization_id?: string
          paused_at?: string | null
          scheduled_at?: string | null
          sent_count?: number
          skipped_opted_out_count?: number
          started_at?: string | null
          status?: string
          throttle_seconds?: number
          total_recipients?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "automated_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_sms_sends: {
        Row: {
          campaign_id: string | null
          campaign_type: string | null
          converted: boolean | null
          converted_at: string | null
          customer_id: string | null
          id: string
          message_content: string | null
          organization_id: string | null
          phone_number: string | null
          sent_at: string
          status: string | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_type?: string | null
          converted?: boolean | null
          converted_at?: string | null
          customer_id?: string | null
          id?: string
          message_content?: string | null
          organization_id?: string | null
          phone_number?: string | null
          sent_at?: string
          status?: string | null
        }
        Update: {
          campaign_id?: string | null
          campaign_type?: string | null
          converted?: boolean | null
          converted_at?: string | null
          customer_id?: string | null
          id?: string
          message_content?: string | null
          organization_id?: string | null
          phone_number?: string | null
          sent_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sms_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "automated_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sms_sends_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sms_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_feedback: {
        Row: {
          canceled_at: string
          competitor_name: string | null
          created_at: string
          eligible_for_winback: boolean
          feedback_text: string | null
          id: string
          kept_text: string | null
          missing_feature: string | null
          organization_id: string | null
          period_end_date: string | null
          plan: string | null
          reason: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          user_email: string | null
          user_id: string
        }
        Insert: {
          canceled_at?: string
          competitor_name?: string | null
          created_at?: string
          eligible_for_winback?: boolean
          feedback_text?: string | null
          id?: string
          kept_text?: string | null
          missing_feature?: string | null
          organization_id?: string | null
          period_end_date?: string | null
          plan?: string | null
          reason: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_email?: string | null
          user_id: string
        }
        Update: {
          canceled_at?: string
          competitor_name?: string | null
          created_at?: string
          eligible_for_winback?: boolean
          feedback_text?: string | null
          id?: string
          kept_text?: string | null
          missing_feature?: string | null
          organization_id?: string | null
          period_end_date?: string | null
          plan?: string | null
          reason?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      charge_audit_log: {
        Row: {
          amount_cents: number | null
          booking_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          failure_reason: string | null
          id: string
          match_status: string
          organization_id: string
          payment_method_id: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          match_status: string
          organization_id: string
          payment_method_id?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          match_status?: string
          organization_id?: string
          payment_method_id?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          requires_photo: boolean | null
          sort_order: number | null
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          requires_photo?: boolean | null
          sort_order?: number | null
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          requires_photo?: boolean | null
          sort_order?: number | null
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          organization_id: string | null
          service_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          organization_id?: string | null
          service_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          organization_id?: string | null
          service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaner_location_tracking: {
        Row: {
          arrived_at: string | null
          booking_id: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          organization_id: string
          recorded_at: string
          staff_id: string
          tracking_token: string
        }
        Insert: {
          arrived_at?: string | null
          booking_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          organization_id: string
          recorded_at?: string
          staff_id: string
          tracking_token?: string
        }
        Update: {
          arrived_at?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          organization_id?: string
          recorded_at?: string
          staff_id?: string
          tracking_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaner_location_tracking_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_location_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_location_tracking_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_location_tracking_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaner_notifications: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          organization_id: string | null
          staff_id: string
          title: string
          type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          organization_id?: string | null
          staff_id: string
          title: string
          type?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          organization_id?: string | null
          staff_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaner_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      client_booking_requests: {
        Row: {
          admin_response_note: string | null
          client_user_id: string
          created_at: string
          customer_id: string
          id: string
          location_id: string | null
          notes: string | null
          organization_id: string
          requested_date: string
          responded_at: string | null
          responded_by: string | null
          service_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_response_note?: string | null
          client_user_id: string
          created_at?: string
          customer_id: string
          id?: string
          location_id?: string | null
          notes?: string | null
          organization_id: string
          requested_date: string
          responded_at?: string | null
          responded_by?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_response_note?: string | null
          client_user_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          requested_date?: string
          responded_at?: string | null
          responded_by?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_booking_requests_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_booking_requests_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_booking_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_booking_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_booking_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_booking_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      client_feedback: {
        Row: {
          created_at: string
          customer_name: string
          feedback_date: string
          followup_needed: boolean | null
          id: string
          is_resolved: boolean | null
          issue_description: string | null
          organization_id: string | null
          resolution: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name: string
          feedback_date?: string
          followup_needed?: boolean | null
          id?: string
          is_resolved?: boolean | null
          issue_description?: string | null
          organization_id?: string | null
          resolution?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          feedback_date?: string
          followup_needed?: boolean | null
          id?: string
          is_resolved?: boolean | null
          issue_description?: string | null
          organization_id?: string | null
          resolution?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notifications: {
        Row: {
          client_user_id: string
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          organization_id: string
          related_request_id: string | null
          title: string
          type: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          organization_id: string
          related_request_id?: string | null
          title: string
          type?: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          organization_id?: string
          related_request_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notifications_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notifications_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_feedback: {
        Row: {
          booking_id: string | null
          client_user_id: string
          comment: string | null
          created_at: string
          customer_id: string
          id: string
          organization_id: string
          rating: number
        }
        Insert: {
          booking_id?: string | null
          client_user_id: string
          comment?: string | null
          created_at?: string
          customer_id: string
          id?: string
          organization_id: string
          rating: number
        }
        Update: {
          booking_id?: string | null
          client_user_id?: string
          comment?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          organization_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_feedback_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_feedback_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_sessions: {
        Row: {
          client_user_id: string | null
          created_at: string
          customer_email: string | null
          duration_seconds: number
          id: string
          is_active: boolean
          organization_id: string | null
          session_end: string | null
          session_start: string
          updated_at: string
        }
        Insert: {
          client_user_id?: string | null
          created_at?: string
          customer_email?: string | null
          duration_seconds?: number
          id?: string
          is_active?: boolean
          organization_id?: string | null
          session_end?: string | null
          session_start?: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string | null
          created_at?: string
          customer_email?: string | null
          duration_seconds?: number
          id?: string
          is_active?: boolean
          organization_id?: string | null
          session_end?: string | null
          session_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_sessions_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_sessions_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_users: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_active: boolean | null
          last_login_at: string | null
          must_change_password: boolean | null
          organization_id: string | null
          password_hash: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          organization_id?: string | null
          password_hash: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          organization_id?: string | null
          password_hash?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tier_settings: {
        Row: {
          benefits: Json | null
          color: string | null
          created_at: string
          discount_percent: number
          id: string
          max_spending: number | null
          min_spending: number
          organization_id: string
          tier_name: string
          tier_order: number
          updated_at: string
        }
        Insert: {
          benefits?: Json | null
          color?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          max_spending?: number | null
          min_spending?: number
          organization_id: string
          tier_name: string
          tier_order?: number
          updated_at?: string
        }
        Update: {
          benefits?: Json | null
          color?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          max_spending?: number | null
          min_spending?: number
          organization_id?: string
          tier_name?: string
          tier_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tier_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      comped_access: {
        Row: {
          access_code_id: string | null
          created_at: string
          expires_at: string
          granted_by: string | null
          id: string
          organization_id: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          access_code_id?: string | null
          created_at?: string
          expires_at: string
          granted_by?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          access_code_id?: string | null
          created_at?: string
          expires_at?: string
          granted_by?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comped_access_code_fk"
            columns: ["access_code_id"]
            isOneToOne: false
            referencedRelation: "access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comped_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_conversations: {
        Row: {
          context: Json
          conversation_id: string
          created_at: string
          id: string
          message_content: string
          message_role: string
          organization_id: string
          user_id: string
        }
        Insert: {
          context?: Json
          conversation_id: string
          created_at?: string
          id?: string
          message_content: string
          message_role: string
          organization_id: string
          user_id: string
        }
        Update: {
          context?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          message_content?: string
          message_role?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_reengagement_log: {
        Row: {
          channel: string
          id: string
          in_app_dismissed_at: string | null
          message_body: string | null
          message_subject: string | null
          metadata: Json
          organization_id: string
          recipient: string | null
          response_at: string | null
          sent_at: string
          trigger_reason: string
          user_id: string | null
          user_responded: boolean
        }
        Insert: {
          channel: string
          id?: string
          in_app_dismissed_at?: string | null
          message_body?: string | null
          message_subject?: string | null
          metadata?: Json
          organization_id: string
          recipient?: string | null
          response_at?: string | null
          sent_at?: string
          trigger_reason: string
          user_id?: string | null
          user_responded?: boolean
        }
        Update: {
          channel?: string
          id?: string
          in_app_dismissed_at?: string | null
          message_body?: string | null
          message_subject?: string | null
          metadata?: Json
          organization_id?: string
          recipient?: string | null
          response_at?: string | null
          sent_at?: string
          trigger_reason?: string
          user_id?: string | null
          user_responded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "copilot_reengagement_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_automation_logs: {
        Row: {
          automation_id: string
          booking_id: string | null
          created_at: string | null
          customer_id: string | null
          error: string | null
          id: string
          organization_id: string
          paused_reason: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          step_id: string | null
        }
        Insert: {
          automation_id: string
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          error?: string | null
          id?: string
          organization_id: string
          paused_reason?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
        }
        Update: {
          automation_id?: string
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          error?: string | null
          id?: string
          organization_id?: string
          paused_reason?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "custom_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_automation_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_automation_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_automation_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_automation_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "custom_automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_automation_steps: {
        Row: {
          automation_id: string
          condition: string
          created_at: string | null
          delay_unit: string
          delay_value: number
          id: string
          message_body: string
          step_order: number
        }
        Insert: {
          automation_id: string
          condition?: string
          created_at?: string | null
          delay_unit?: string
          delay_value?: number
          id?: string
          message_body: string
          step_order?: number
        }
        Update: {
          automation_id?: string
          condition?: string
          created_at?: string | null
          delay_unit?: string
          delay_value?: number
          id?: string
          message_body?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_automation_steps_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "custom_automations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_automations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          overrides_default: string | null
          tag_filter: string | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          overrides_default?: string | null
          tag_filter?: string | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          overrides_default?: string | null
          tag_filter?: string | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_frequencies: {
        Row: {
          created_at: string
          days_of_week: number[] | null
          discount_pct: number
          id: string
          interval_days: number
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[] | null
          discount_pct?: number
          id?: string
          interval_days: number
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[] | null
          discount_pct?: number
          id?: string
          interval_days?: number
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_frequencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_work_requests: {
        Row: {
          admin_notes: string | null
          billing_period_end: string
          billing_period_start: string
          created_at: string
          declined_reason: string | null
          details: string | null
          fulfilled_at: string | null
          id: string
          organization_id: string
          request_type: string
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          billing_period_end: string
          billing_period_start: string
          created_at?: string
          declined_reason?: string | null
          details?: string | null
          fulfilled_at?: string | null
          id?: string
          organization_id: string
          request_type: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          billing_period_end?: string
          billing_period_start?: string
          created_at?: string
          declined_reason?: string | null
          details?: string | null
          fulfilled_at?: string | null
          id?: string
          organization_id?: string
          request_type?: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_work_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_duplicate_ignored: {
        Row: {
          customer_a_id: string
          customer_b_id: string
          id: string
          ignored_at: string
          ignored_by: string | null
          organization_id: string
        }
        Insert: {
          customer_a_id: string
          customer_b_id: string
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          organization_id: string
        }
        Update: {
          customer_a_id?: string
          customer_b_id?: string
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_duplicate_ignored_customer_a_id_fkey"
            columns: ["customer_a_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_duplicate_ignored_customer_b_id_fkey"
            columns: ["customer_b_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_duplicate_ignored_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_intelligence: {
        Row: {
          ai_insights: Json | null
          behavior_patterns: Json | null
          churn_risk_level: string | null
          churn_risk_score: number | null
          created_at: string | null
          customer_id: string
          days_since_last_contact: number | null
          id: string
          is_vip: boolean | null
          last_calculated_at: string | null
          next_booking_probability: number | null
          organization_id: string
          predicted_lifetime_value: number | null
          predicted_next_booking_date: string | null
          predicted_review_score: number | null
          recommended_services: Json | null
          sentiment_score: number | null
          sentiment_trend: string | null
          updated_at: string | null
          upsell_potential_score: number | null
          vip_reason: string | null
        }
        Insert: {
          ai_insights?: Json | null
          behavior_patterns?: Json | null
          churn_risk_level?: string | null
          churn_risk_score?: number | null
          created_at?: string | null
          customer_id: string
          days_since_last_contact?: number | null
          id?: string
          is_vip?: boolean | null
          last_calculated_at?: string | null
          next_booking_probability?: number | null
          organization_id: string
          predicted_lifetime_value?: number | null
          predicted_next_booking_date?: string | null
          predicted_review_score?: number | null
          recommended_services?: Json | null
          sentiment_score?: number | null
          sentiment_trend?: string | null
          updated_at?: string | null
          upsell_potential_score?: number | null
          vip_reason?: string | null
        }
        Update: {
          ai_insights?: Json | null
          behavior_patterns?: Json | null
          churn_risk_level?: string | null
          churn_risk_score?: number | null
          created_at?: string | null
          customer_id?: string
          days_since_last_contact?: number | null
          id?: string
          is_vip?: boolean | null
          last_calculated_at?: string | null
          next_booking_probability?: number | null
          organization_id?: string
          predicted_lifetime_value?: number | null
          predicted_next_booking_date?: string | null
          predicted_review_score?: number | null
          recommended_services?: Json | null
          sentiment_score?: number | null
          sentiment_trend?: string | null
          updated_at?: string | null
          upsell_potential_score?: number | null
          vip_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_intelligence_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_intelligence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string
          lifetime_points: number | null
          lifetime_spend: number
          organization_id: string | null
          points: number | null
          tier: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lifetime_points?: number | null
          lifetime_spend?: number
          organization_id?: string | null
          points?: number | null
          tier?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lifetime_points?: number | null
          lifetime_spend?: number
          organization_id?: string | null
          points?: number | null
          tier?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          credits: number | null
          customer_status: string
          email: string | null
          first_name: string
          id: string
          is_recurring: boolean
          last_name: string
          latitude: number | null
          longitude: number | null
          marketing_status: string
          merged_into: string | null
          notes: string | null
          opted_out_at: string | null
          opted_out_campaign_id: string | null
          opted_out_method: string | null
          organization_id: string | null
          phone: string | null
          referral_code: string
          review_request_sent: boolean
          review_request_sent_at: string | null
          state: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          updated_at: string
          user_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          credits?: number | null
          customer_status?: string
          email?: string | null
          first_name: string
          id?: string
          is_recurring?: boolean
          last_name: string
          latitude?: number | null
          longitude?: number | null
          marketing_status?: string
          merged_into?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_campaign_id?: string | null
          opted_out_method?: string | null
          organization_id?: string | null
          phone?: string | null
          referral_code?: string
          review_request_sent?: boolean
          review_request_sent_at?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
          user_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          credits?: number | null
          customer_status?: string
          email?: string | null
          first_name?: string
          id?: string
          is_recurring?: boolean
          last_name?: string
          latitude?: number | null
          longitude?: number | null
          marketing_status?: string
          merged_into?: string | null
          notes?: string | null
          opted_out_at?: string | null
          opted_out_campaign_id?: string | null
          opted_out_method?: string | null
          organization_id?: string | null
          phone?: string | null
          referral_code?: string
          review_request_sent?: boolean
          review_request_sent_at?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
          user_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_opted_out_campaign_id_fkey"
            columns: ["opted_out_campaign_id"]
            isOneToOne: false
            referencedRelation: "automated_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_blocked_dates: {
        Row: {
          blocked_date: string
          created_at: string | null
          id: string
          notes: string | null
          reason: string | null
        }
        Insert: {
          blocked_date: string
          created_at?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Update: {
          blocked_date?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      demo_bookings: {
        Row: {
          biggest_challenge: string | null
          booked_date: string
          booked_time: string
          business_name: string
          cancellation_reason: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          meeting_link: string | null
          original_date: string | null
          original_time: string | null
          phone: string
          reschedule_note: string | null
          status: string | null
          team_size: string | null
          timezone: string | null
        }
        Insert: {
          biggest_challenge?: string | null
          booked_date: string
          booked_time: string
          business_name: string
          cancellation_reason?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          meeting_link?: string | null
          original_date?: string | null
          original_time?: string | null
          phone: string
          reschedule_note?: string | null
          status?: string | null
          team_size?: string | null
          timezone?: string | null
        }
        Update: {
          biggest_challenge?: string | null
          booked_date?: string
          booked_time?: string
          business_name?: string
          cancellation_reason?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          meeting_link?: string | null
          original_date?: string | null
          original_time?: string | null
          phone?: string
          reschedule_note?: string | null
          status?: string | null
          team_size?: string | null
          timezone?: string | null
        }
        Relationships: []
      }
      demo_reminder_log: {
        Row: {
          demo_booking_id: string
          id: string
          reminder_type: string
          sent_at: string
        }
        Insert: {
          demo_booking_id: string
          id?: string
          reminder_type: string
          sent_at?: string
        }
        Update: {
          demo_booking_id?: string
          id?: string
          reminder_type?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_reminder_log_demo_booking_id_fkey"
            columns: ["demo_booking_id"]
            isOneToOne: false
            referencedRelation: "demo_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_requests: {
        Row: {
          biggest_challenge: string | null
          business_name: string
          created_at: string | null
          email: string
          full_name: string
          id: string
          notes: string | null
          phone: string
          preferred_days: string[] | null
          preferred_time: string | null
          status: string | null
          team_size: string | null
        }
        Insert: {
          biggest_challenge?: string | null
          business_name: string
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          preferred_days?: string[] | null
          preferred_time?: string | null
          status?: string | null
          team_size?: string | null
        }
        Update: {
          biggest_challenge?: string | null
          business_name?: string
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          preferred_days?: string[] | null
          preferred_time?: string | null
          status?: string | null
          team_size?: string | null
        }
        Relationships: []
      }
      deposit_requests: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          customer_name: string
          customer_phone: string | null
          id: string
          organization_id: string
          paid_at: string | null
          payment_intent_id: string | null
          sms_sent_at: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          id?: string
          organization_id: string
          paid_at?: string | null
          payment_intent_id?: string | null
          sms_sent_at?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          id?: string
          organization_id?: string
          paid_at?: string | null
          payment_intent_id?: string | null
          sms_sent_at?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discounts: {
        Row: {
          code: string
          created_at: string
          current_uses: number | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          is_test: boolean | null
          max_uses: number | null
          min_order_amount: number | null
          organization_id: string
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string
          current_uses?: number | null
          description?: string | null
          discount_type: string
          discount_value: number
          id?: string
          is_active?: boolean | null
          is_test?: boolean | null
          max_uses?: number | null
          min_order_amount?: number | null
          organization_id: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_uses?: number | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          is_test?: boolean | null
          max_uses?: number | null
          min_order_amount?: number | null
          organization_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          customer_email: string | null
          drafted_evidence: Json | null
          id: string
          matching_prior_count: number | null
          outcome: string | null
          qualifies_for_ce3: boolean | null
          raw_event: Json | null
          reason: string | null
          status: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_dispute_id: string
          stripe_payment_intent_id: string | null
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          drafted_evidence?: Json | null
          id?: string
          matching_prior_count?: number | null
          outcome?: string | null
          qualifies_for_ce3?: boolean | null
          raw_event?: Json | null
          reason?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_dispute_id: string
          stripe_payment_intent_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          drafted_evidence?: Json | null
          id?: string
          matching_prior_count?: number | null
          outcome?: string | null
          qualifies_for_ce3?: boolean | null
          raw_event?: Json | null
          reason?: string | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_dispute_id?: string
          stripe_payment_intent_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_bounce_cursor: {
        Row: {
          last_uid: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          last_uid?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          last_uid?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_bounce_cursor_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_failures: {
        Row: {
          attempted_at: string
          error: string
          id: string
          organization_id: string
          provider: string
          recipient: string
          subject: string | null
        }
        Insert: {
          attempted_at?: string
          error: string
          id?: string
          organization_id: string
          provider?: string
          recipient: string
          subject?: string | null
        }
        Update: {
          attempted_at?: string
          error?: string
          id?: string
          organization_id?: string
          provider?: string
          recipient?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          bounce_detail: string | null
          bounce_type: string | null
          bounced_at: string | null
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          organization_id: string | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          bounce_detail?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          organization_id?: string | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          bounce_detail?: string | null
          bounce_type?: string | null
          bounced_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          organization_id?: string | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          bounce_count: number
          email: string
          first_bounced_at: string
          last_bounce_detail: string | null
          organization_id: string
          reason: string
        }
        Insert: {
          bounce_count?: number
          email: string
          first_bounced_at?: string
          last_bounce_detail?: string | null
          organization_id: string
          reason: string
        }
        Update: {
          bounce_count?: number
          email?: string
          first_bounced_at?: string
          last_bounce_detail?: string | null
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      estimates: {
        Row: {
          bathrooms: string | null
          bedrooms: string | null
          client_address: string | null
          client_city: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          client_state: string | null
          client_zip: string | null
          converted_booking_id: string | null
          created_at: string | null
          created_by: string | null
          custom_line_items: Json | null
          customer_id: string | null
          estimated_total: number | null
          floors: string | null
          has_pets: boolean | null
          id: string
          notes: string | null
          organization_id: string
          photos: Json | null
          property_type: string | null
          quote_approved_at: string | null
          quote_declined_at: string | null
          quote_sent_at: string | null
          quote_token: string | null
          room_notes: Json | null
          selected_extras: Json | null
          selected_services: Json | null
          square_footage: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          bathrooms?: string | null
          bedrooms?: string | null
          client_address?: string | null
          client_city?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_state?: string | null
          client_zip?: string | null
          converted_booking_id?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_line_items?: Json | null
          customer_id?: string | null
          estimated_total?: number | null
          floors?: string | null
          has_pets?: boolean | null
          id?: string
          notes?: string | null
          organization_id: string
          photos?: Json | null
          property_type?: string | null
          quote_approved_at?: string | null
          quote_declined_at?: string | null
          quote_sent_at?: string | null
          quote_token?: string | null
          room_notes?: Json | null
          selected_extras?: Json | null
          selected_services?: Json | null
          square_footage?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          bathrooms?: string | null
          bedrooms?: string | null
          client_address?: string | null
          client_city?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_state?: string | null
          client_zip?: string | null
          converted_booking_id?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_line_items?: Json | null
          customer_id?: string | null
          estimated_total?: number | null
          floors?: string | null
          has_pets?: boolean | null
          id?: string
          notes?: string | null
          organization_id?: string
          photos?: Json | null
          property_type?: string | null
          quote_approved_at?: string | null
          quote_declined_at?: string | null
          quote_sent_at?: string | null
          quote_token?: string | null
          room_notes?: Json | null
          selected_extras?: Json | null
          selected_services?: Json | null
          square_footage?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_converted_booking_id_fkey"
            columns: ["converted_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          expense_date: string
          id: string
          organization_id: string | null
          receipt_url: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          description: string
          expense_date?: string
          id?: string
          organization_id?: string | null
          receipt_url?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
          organization_id?: string | null
          receipt_url?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_booking_keys: {
        Row: {
          active: boolean
          created_at: string
          key_hash: string
          label: string | null
          last_used_at: string | null
          organization_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          key_hash: string
          label?: string | null
          last_used_at?: string | null
          organization_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          key_hash?: string
          label?: string | null
          last_used_at?: string | null
          organization_id?: string
        }
        Relationships: []
      }
      facebook_lead_ingestions: {
        Row: {
          created_at: string
          lead_id: string | null
          leadgen_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          lead_id?: string | null
          leadgen_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          lead_id?: string | null
          leadgen_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_lead_ingestions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facebook_lead_ingestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_lead_webhook_events: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          payload: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          payload?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "facebook_lead_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_page_connections: {
        Row: {
          connected_by: string | null
          created_at: string
          is_active: boolean
          organization_id: string
          page_access_token: string | null
          page_id: string
          page_name: string | null
          updated_at: string
        }
        Insert: {
          connected_by?: string | null
          created_at?: string
          is_active?: boolean
          organization_id: string
          page_access_token?: string | null
          page_id: string
          page_name?: string | null
          updated_at?: string
        }
        Update: {
          connected_by?: string | null
          created_at?: string
          is_active?: boolean
          organization_id?: string
          page_access_token?: string | null
          page_id?: string
          page_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_page_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_dispatch_log: {
        Row: {
          attempt: number
          created_at: string
          error_code: string | null
          error_hint: string | null
          event_type: string
          http_status: number | null
          id: string
          latency_ms: number | null
          organization_id: string
          payload: Json | null
          response_snippet: string | null
          status: string
          webhook_url: string | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          error_code?: string | null
          error_hint?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          organization_id: string
          payload?: Json | null
          response_snippet?: string | null
          status: string
          webhook_url?: string | null
        }
        Update: {
          attempt?: number
          created_at?: string
          error_code?: string | null
          error_hint?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          organization_id?: string
          payload?: Json | null
          response_snippet?: string | null
          status?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_dispatch_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      help_videos: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_recommended: boolean | null
          loom_url: string
          organization_id: string | null
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_recommended?: boolean | null
          loom_url: string
          organization_id?: string | null
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_recommended?: boolean | null
          loom_url?: string
          organization_id?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_videos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_custom_fields: {
        Row: {
          created_at: string
          field_name: string
          field_type: string
          id: string
          is_required: boolean | null
          options: Json | null
          organization_id: string | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_name: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_custom_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          cost_per_unit: number | null
          created_at: string
          custom_fields: Json | null
          description: string | null
          id: string
          last_restocked_at: string | null
          min_quantity: number | null
          name: string
          organization_id: string | null
          quantity: number
          supplier: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          custom_fields?: Json | null
          description?: string | null
          id?: string
          last_restocked_at?: string | null
          min_quantity?: number | null
          name: string
          organization_id?: string | null
          quantity?: number
          supplier?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          custom_fields?: Json | null
          description?: string | null
          id?: string
          last_restocked_at?: string | null
          min_quantity?: number | null
          name?: string
          organization_id?: string | null
          quantity?: number
          supplier?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_branding: {
        Row: {
          accent_color: string | null
          created_at: string | null
          font_style: string | null
          footer_message: string | null
          header_layout: string | null
          id: string
          logo_url: string | null
          organization_id: string
          primary_color: string | null
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          created_at?: string | null
          font_style?: string | null
          footer_message?: string | null
          header_layout?: string | null
          id?: string
          logo_url?: string | null
          organization_id: string
          primary_color?: string | null
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          created_at?: string | null
          font_style?: string | null
          footer_message?: string | null
          header_layout?: string | null
          id?: string
          logo_url?: string | null
          organization_id?: string
          primary_color?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_branding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          organization_id: string | null
          quantity: number
          service_id: string | null
          sort_order: number | null
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          organization_id?: string | null
          quantity?: number
          service_id?: string | null
          sort_order?: number | null
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          organization_id?: string | null
          quantity?: number
          service_id?: string | null
          sort_order?: number | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payment_reminders: {
        Row: {
          created_at: string
          days_after_due: number
          id: string
          is_active: boolean | null
          organization_id: string
          send_email: boolean | null
          send_sms: boolean | null
        }
        Insert: {
          created_at?: string
          days_after_due?: number
          id?: string
          is_active?: boolean | null
          organization_id: string
          send_email?: boolean | null
          send_sms?: boolean | null
        }
        Update: {
          created_at?: string
          days_after_due?: number
          id?: string
          is_active?: boolean | null
          organization_id?: string
          send_email?: boolean | null
          send_sms?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payment_reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          address: string | null
          cc_emails: string[]
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount_amount: number | null
          discount_percent: number | null
          due_date: string | null
          id: string
          invoice_number: number
          is_recurring: boolean | null
          lead_id: string | null
          notes: string | null
          organization_id: string | null
          paid_at: string | null
          recurring_interval: string | null
          scheduled_send_at: string | null
          send_copy_to_self: boolean | null
          sent_at: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_invoice_url: string | null
          stripe_payment_intent_id: string | null
          subtotal: number
          tax_amount: number | null
          tax_percent: number | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          cc_emails?: string[]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          due_date?: string | null
          id?: string
          invoice_number?: number
          is_recurring?: boolean | null
          lead_id?: string | null
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          recurring_interval?: string | null
          scheduled_send_at?: string | null
          send_copy_to_self?: boolean | null
          sent_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number
          tax_amount?: number | null
          tax_percent?: number | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          cc_emails?: string[]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          due_date?: string | null
          id?: string
          invoice_number?: number
          is_recurring?: boolean | null
          lead_id?: string | null
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          recurring_interval?: string | null
          scheduled_send_at?: string | null
          send_copy_to_self?: boolean | null
          sent_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number
          tax_amount?: number | null
          tax_percent?: number | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_intelligence: {
        Row: {
          ai_insights: Json | null
          behavior_patterns: Json | null
          conversion_score: number | null
          created_at: string | null
          engagement_score: number | null
          id: string
          is_hot_lead: boolean | null
          last_calculated_at: string | null
          lead_id: string
          organization_id: string
          predicted_conversion_rate: number | null
          preferred_contact_method: string | null
          recommended_followup_time: string | null
          updated_at: string | null
          urgency_score: number | null
        }
        Insert: {
          ai_insights?: Json | null
          behavior_patterns?: Json | null
          conversion_score?: number | null
          created_at?: string | null
          engagement_score?: number | null
          id?: string
          is_hot_lead?: boolean | null
          last_calculated_at?: string | null
          lead_id: string
          organization_id: string
          predicted_conversion_rate?: number | null
          preferred_contact_method?: string | null
          recommended_followup_time?: string | null
          updated_at?: string | null
          urgency_score?: number | null
        }
        Update: {
          ai_insights?: Json | null
          behavior_patterns?: Json | null
          conversion_score?: number | null
          created_at?: string | null
          engagement_score?: number | null
          id?: string
          is_hot_lead?: boolean | null
          last_calculated_at?: string | null
          lead_id?: string
          organization_id?: string
          predicted_conversion_rate?: number | null
          preferred_contact_method?: string | null
          recommended_followup_time?: string | null
          updated_at?: string | null
          urgency_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_intelligence_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intelligence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notification_sends: {
        Row: {
          claimed_at: string
          completed_at: string | null
          lead_id: string
          organization_id: string
          phone_key: string | null
          skip_reason: string | null
          status: string
        }
        Insert: {
          claimed_at?: string
          completed_at?: string | null
          lead_id: string
          organization_id: string
          phone_key?: string | null
          skip_reason?: string | null
          status?: string
        }
        Update: {
          claimed_at?: string
          completed_at?: string | null
          lead_id?: string
          organization_id?: string
          phone_key?: string | null
          skip_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notification_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notification_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_pipeline_stages: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label: string
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          label?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          assigned_to: string | null
          backfilled_at: string | null
          city: string | null
          created_at: string
          email: string | null
          estimated_value: number | null
          id: string
          message: string | null
          name: string
          notes: string | null
          organization_id: string | null
          phone: string | null
          service_interest: string | null
          source: string | null
          state: string | null
          status: string | null
          tags: Json
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          assigned_to?: string | null
          backfilled_at?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          estimated_value?: number | null
          id?: string
          message?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          service_interest?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          tags?: Json
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          assigned_to?: string | null
          backfilled_at?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          estimated_value?: number | null
          id?: string
          message?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          service_interest?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          tags?: Json
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lifetime_access_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          email: string
          id: string
          organization_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          email: string
          id?: string
          organization_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          email?: string
          id?: string
          organization_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lifetime_access_purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lifetime_offer_state: {
        Row: {
          id: number
          sold_out_at: string | null
          sold_spots: number
          total_spots: number
          updated_at: string
        }
        Insert: {
          id?: number
          sold_out_at?: string | null
          sold_spots?: number
          total_spots?: number
          updated_at?: string
        }
        Update: {
          id?: number
          sold_out_at?: string | null
          sold_spots?: number
          total_spots?: number
          updated_at?: string
        }
        Relationships: []
      }
      lifetime_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          address: string | null
          apt_suite: string | null
          city: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          organization_id: string | null
          phone: string | null
          price_override: number | null
          service_area_zip_codes: string[] | null
          state: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          apt_suite?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          organization_id?: string | null
          phone?: string | null
          price_override?: number | null
          service_area_zip_codes?: string[] | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          apt_suite?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          organization_id?: string | null
          phone?: string | null
          price_override?: number | null
          service_area_zip_codes?: string[] | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tier_correction_audit: {
        Row: {
          captured_at: string
          completed_spend: number | null
          correct_tier: string | null
          customer_id: string
          id: string
          organization_id: string | null
          phase: string
          stored_tier: string | null
        }
        Insert: {
          captured_at?: string
          completed_spend?: number | null
          correct_tier?: string | null
          customer_id: string
          id?: string
          organization_id?: string | null
          phase: string
          stored_tier?: string | null
        }
        Update: {
          captured_at?: string
          completed_spend?: number | null
          correct_tier?: string | null
          customer_id?: string
          id?: string
          organization_id?: string | null
          phase?: string
          stored_tier?: string | null
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          booking_id: string | null
          created_at: string | null
          customer_id: string | null
          description: string | null
          id: string
          organization_id: string | null
          points: number
          transaction_type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          points: number
          transaction_type: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          points?: number
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_name: string
          description: string | null
          id: string
          organization_id: string
          stripe_charge_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_name: string
          description?: string | null
          id?: string
          organization_id: string
          stripe_charge_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string
          description?: string | null
          id?: string
          organization_id?: string
          stripe_charge_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_sentiment_log: {
        Row: {
          analyzed_at: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          key_topics: Json | null
          lead_id: string | null
          message_direction: string
          message_preview: string | null
          message_source: string
          organization_id: string
          sentiment_label: string | null
          sentiment_score: number | null
          urgency_detected: boolean | null
        }
        Insert: {
          analyzed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          key_topics?: Json | null
          lead_id?: string | null
          message_direction: string
          message_preview?: string | null
          message_source: string
          organization_id: string
          sentiment_label?: string | null
          sentiment_score?: number | null
          urgency_detected?: boolean | null
        }
        Update: {
          analyzed_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          key_topics?: Json | null
          lead_id?: string | null
          message_direction?: string
          message_preview?: string | null
          message_source?: string
          organization_id?: string
          sentiment_label?: string | null
          sentiment_score?: number | null
          urgency_detected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "message_sentiment_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_sentiment_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_sentiment_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_import_rows: {
        Row: {
          created_at: string
          created_record_id: string | null
          duplicate_of: string | null
          id: string
          import_id: string
          mapped_data: Json
          organization_id: string
          raw_data: Json
          row_number: number
          status: string
          validation_errors: Json | null
        }
        Insert: {
          created_at?: string
          created_record_id?: string | null
          duplicate_of?: string | null
          id?: string
          import_id: string
          mapped_data?: Json
          organization_id: string
          raw_data?: Json
          row_number: number
          status?: string
          validation_errors?: Json | null
        }
        Update: {
          created_at?: string
          created_record_id?: string | null
          duplicate_of?: string | null
          id?: string
          import_id?: string
          mapped_data?: Json
          organization_id?: string
          raw_data?: Json
          row_number?: number
          status?: string
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "migration_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "migration_import_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_imports: {
        Row: {
          completed_at: string | null
          created_at: string
          data_type: string
          duplicate_rows: number | null
          error_log: Json | null
          error_rows: number | null
          field_mapping: Json | null
          id: string
          import_summary: Json | null
          imported_rows: number | null
          organization_id: string
          original_filename: string | null
          skipped_rows: number | null
          source: string
          started_at: string | null
          status: string
          total_rows: number | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          data_type: string
          duplicate_rows?: number | null
          error_log?: Json | null
          error_rows?: number | null
          field_mapping?: Json | null
          id?: string
          import_summary?: Json | null
          imported_rows?: number | null
          organization_id: string
          original_filename?: string | null
          skipped_rows?: number | null
          source: string
          started_at?: string | null
          status?: string
          total_rows?: number | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          data_type?: string
          duplicate_rows?: number | null
          error_log?: Json | null
          error_rows?: number | null
          field_mapping?: Json | null
          id?: string
          import_summary?: Json | null
          imported_rows?: number | null
          organization_id?: string
          original_filename?: string | null
          skipped_rows?: number | null
          source?: string
          started_at?: string | null
          status?: string
          total_rows?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_queue: {
        Row: {
          action: string
          created_at: string
          id: string
          organization_id: string
          record_data: Json
          synced: boolean | null
          synced_at: string | null
          table_name: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          organization_id: string
          record_data: Json
          synced?: boolean | null
          synced_at?: string | null
          table_name: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          organization_id?: string
          record_data?: Json
          synced?: boolean | null
          synced_at?: string | null
          table_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          activated_at: string | null
          copilot_dismissed_at: string | null
          copilot_enabled: boolean
          created_at: string
          csv_imports_attempted: number
          csv_imports_succeeded: number
          id: string
          last_engagement_at: string | null
          milestone_1_company_info_completed_at: string | null
          milestone_2_services_pricing_completed_at: string | null
          milestone_3_clients_added_completed_at: string | null
          milestone_4_staff_added_completed_at: string | null
          milestone_5_stripe_connected_completed_at: string | null
          milestone_6_first_booking_completed_at: string | null
          organization_id: string
          reengagement_count: number
          reengagement_paused: boolean
          tour_completed_at: string | null
          tour_current_step: number
          tour_skipped_at: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          copilot_dismissed_at?: string | null
          copilot_enabled?: boolean
          created_at?: string
          csv_imports_attempted?: number
          csv_imports_succeeded?: number
          id?: string
          last_engagement_at?: string | null
          milestone_1_company_info_completed_at?: string | null
          milestone_2_services_pricing_completed_at?: string | null
          milestone_3_clients_added_completed_at?: string | null
          milestone_4_staff_added_completed_at?: string | null
          milestone_5_stripe_connected_completed_at?: string | null
          milestone_6_first_booking_completed_at?: string | null
          organization_id: string
          reengagement_count?: number
          reengagement_paused?: boolean
          tour_completed_at?: string | null
          tour_current_step?: number
          tour_skipped_at?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          copilot_dismissed_at?: string | null
          copilot_enabled?: boolean
          created_at?: string
          csv_imports_attempted?: number
          csv_imports_succeeded?: number
          id?: string
          last_engagement_at?: string | null
          milestone_1_company_info_completed_at?: string | null
          milestone_2_services_pricing_completed_at?: string | null
          milestone_3_clients_added_completed_at?: string | null
          milestone_4_staff_added_completed_at?: string | null
          milestone_5_stripe_connected_completed_at?: string | null
          milestone_6_first_booking_completed_at?: string | null
          organization_id?: string
          reengagement_count?: number
          reengagement_paused?: boolean
          tour_completed_at?: string | null
          tour_current_step?: number
          tour_skipped_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      openphone_calls: {
        Row: {
          ai_summary: string | null
          caller_name: string | null
          caller_phone: string | null
          created_at: string | null
          direction: string
          duration: number | null
          ended_at: string | null
          has_recording: boolean | null
          has_summary: boolean | null
          has_transcript: boolean | null
          has_voicemail: boolean | null
          id: string
          matched_customer_id: string | null
          matched_lead_id: string | null
          openphone_call_id: string
          organization_id: string
          phone_number_id: string | null
          raw_data: Json | null
          recording_url: string | null
          started_at: string | null
          status: string
          transcript: Json | null
          updated_at: string | null
          voicemail_transcript: string | null
          voicemail_url: string | null
        }
        Insert: {
          ai_summary?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string | null
          direction?: string
          duration?: number | null
          ended_at?: string | null
          has_recording?: boolean | null
          has_summary?: boolean | null
          has_transcript?: boolean | null
          has_voicemail?: boolean | null
          id?: string
          matched_customer_id?: string | null
          matched_lead_id?: string | null
          openphone_call_id: string
          organization_id: string
          phone_number_id?: string | null
          raw_data?: Json | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          transcript?: Json | null
          updated_at?: string | null
          voicemail_transcript?: string | null
          voicemail_url?: string | null
        }
        Update: {
          ai_summary?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string | null
          direction?: string
          duration?: number | null
          ended_at?: string | null
          has_recording?: boolean | null
          has_summary?: boolean | null
          has_transcript?: boolean | null
          has_voicemail?: boolean | null
          id?: string
          matched_customer_id?: string | null
          matched_lead_id?: string | null
          openphone_call_id?: string
          organization_id?: string
          phone_number_id?: string | null
          raw_data?: Json | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          transcript?: Json | null
          updated_at?: string | null
          voicemail_transcript?: string | null
          voicemail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "openphone_calls_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "openphone_calls_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "openphone_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operations_tracker: {
        Row: {
          closed_deals: number | null
          cold_calls_made: number | null
          cold_emails_sent: number | null
          created_at: string
          id: string
          incoming_calls: number | null
          jobs_completed: number | null
          leads_followed_up: number | null
          notes: string | null
          organization_id: string | null
          revenue_booked: number | null
          track_date: string
          updated_at: string
        }
        Insert: {
          closed_deals?: number | null
          cold_calls_made?: number | null
          cold_emails_sent?: number | null
          created_at?: string
          id?: string
          incoming_calls?: number | null
          jobs_completed?: number | null
          leads_followed_up?: number | null
          notes?: string | null
          organization_id?: string | null
          revenue_booked?: number | null
          track_date?: string
          updated_at?: string
        }
        Update: {
          closed_deals?: number | null
          cold_calls_made?: number | null
          cold_emails_sent?: number | null
          created_at?: string
          id?: string
          incoming_calls?: number | null
          jobs_completed?: number | null
          leads_followed_up?: number | null
          notes?: string | null
          organization_id?: string | null
          revenue_booked?: number | null
          track_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_tracker_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_email_daily_sends: {
        Row: {
          method: string
          organization_id: string
          sent_count: number
          sent_on: string
          updated_at: string
        }
        Insert: {
          method?: string
          organization_id: string
          sent_count?: number
          sent_on?: string
          updated_at?: string
        }
        Update: {
          method?: string
          organization_id?: string
          sent_count?: number
          sent_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_email_daily_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_email_send_failures: {
        Row: {
          created_at: string
          error_message: string | null
          fell_back_to: string | null
          id: string
          method: string
          organization_id: string
          recipient: string | null
          subject: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          fell_back_to?: string | null
          id?: string
          method: string
          organization_id: string
          recipient?: string | null
          subject?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          fell_back_to?: string | null
          id?: string
          method?: string
          organization_id?: string
          recipient?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_email_send_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_feature_flags: {
        Row: {
          ai_assistant_enabled: boolean | null
          daily_reports_enabled: boolean | null
          demo_requests_enabled: boolean | null
          id: string
          integration_hub_enabled: boolean | null
          openphone_calls_enabled: boolean | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          ai_assistant_enabled?: boolean | null
          daily_reports_enabled?: boolean | null
          demo_requests_enabled?: boolean | null
          id?: string
          integration_hub_enabled?: boolean | null
          openphone_calls_enabled?: boolean | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          ai_assistant_enabled?: boolean | null
          daily_reports_enabled?: boolean | null
          demo_requests_enabled?: boolean | null
          id?: string
          integration_hub_enabled?: boolean | null
          openphone_calls_enabled?: boolean | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_feature_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_ghl_settings: {
        Row: {
          auth_header_name: string
          auth_token: string | null
          created_at: string
          enabled: boolean
          event_config: Json
          id: string
          organization_id: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          auth_header_name?: string
          auth_token?: string | null
          created_at?: string
          enabled?: boolean
          event_config?: Json
          id?: string
          organization_id: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          auth_header_name?: string
          auth_token?: string | null
          created_at?: string
          enabled?: boolean
          event_config?: Json
          id?: string
          organization_id?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_ghl_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_gmail_connections: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          connected_at: string
          connected_by_user_id: string | null
          created_at: string
          google_email: string
          id: string
          last_refreshed_at: string | null
          last_send_at: string | null
          organization_id: string
          refresh_token_encrypted: string
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_at?: string
          connected_by_user_id?: string | null
          created_at?: string
          google_email: string
          id?: string
          last_refreshed_at?: string | null
          last_send_at?: string | null
          organization_id: string
          refresh_token_encrypted: string
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_at?: string
          connected_by_user_id?: string | null
          created_at?: string
          google_email?: string
          id?: string
          last_refreshed_at?: string | null
          last_send_at?: string | null
          organization_id?: string
          refresh_token_encrypted?: string
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_gmail_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_referral_bonuses: {
        Row: {
          granted_at: string
          id: string
          months: number
          organization_id: string
          qualifying_referral_ids: string[]
        }
        Insert: {
          granted_at?: string
          id?: string
          months: number
          organization_id: string
          qualifying_referral_ids: string[]
        }
        Update: {
          granted_at?: string
          id?: string
          months?: number
          organization_id?: string
          qualifying_referral_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "org_referral_bonuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_referral_codes: {
        Row: {
          code: string
          created_at: string
          organization_id: string
        }
        Insert: {
          code: string
          created_at?: string
          organization_id: string
        }
        Update: {
          code?: string
          created_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_referral_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_referral_credits: {
        Row: {
          active_coupon_id: string | null
          months_granted: number
          months_redeemed: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          active_coupon_id?: string | null
          months_granted?: number
          months_redeemed?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          active_coupon_id?: string | null
          months_granted?: number
          months_redeemed?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_referral_credits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_referral_redemptions: {
        Row: {
          coupon_id: string | null
          organization_id: string
          redeemed_at: string
          stripe_invoice_id: string
        }
        Insert: {
          coupon_id?: string | null
          organization_id: string
          redeemed_at?: string
          stripe_invoice_id: string
        }
        Update: {
          coupon_id?: string | null
          organization_id?: string
          redeemed_at?: string
          stripe_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_referral_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_referrals: {
        Row: {
          created_at: string
          id: string
          referral_code: string
          referred_card_fingerprint: string | null
          referred_discount_applied_at: string | null
          referred_first_payment_at: string | null
          referred_org_id: string
          referred_paid_invoice_count: number
          referred_second_payment_at: string | null
          referrer_org_id: string
          referrer_reward_granted_at: string | null
          rejection_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code: string
          referred_card_fingerprint?: string | null
          referred_discount_applied_at?: string | null
          referred_first_payment_at?: string | null
          referred_org_id: string
          referred_paid_invoice_count?: number
          referred_second_payment_at?: string | null
          referrer_org_id: string
          referrer_reward_granted_at?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code?: string
          referred_card_fingerprint?: string | null
          referred_discount_applied_at?: string | null
          referred_first_payment_at?: string | null
          referred_org_id?: string
          referred_paid_invoice_count?: number
          referred_second_payment_at?: string | null
          referrer_org_id?: string
          referrer_reward_granted_at?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_referrals_referred_org_id_fkey"
            columns: ["referred_org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_referrals_referrer_org_id_fkey"
            columns: ["referrer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_stripe_settings: {
        Row: {
          connected_at: string | null
          created_at: string
          id: string
          is_connected: boolean | null
          organization_id: string
          stripe_access_token: string | null
          stripe_account_id: string | null
          stripe_default_currency: string | null
          stripe_display_name: string | null
          stripe_payouts_enabled: boolean | null
          stripe_publishable_key: string | null
          stripe_refresh_token: string | null
          stripe_secret_key: string | null
          stripe_user_email: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          id?: string
          is_connected?: boolean | null
          organization_id: string
          stripe_access_token?: string | null
          stripe_account_id?: string | null
          stripe_default_currency?: string | null
          stripe_display_name?: string | null
          stripe_payouts_enabled?: boolean | null
          stripe_publishable_key?: string | null
          stripe_refresh_token?: string | null
          stripe_secret_key?: string | null
          stripe_user_email?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          id?: string
          is_connected?: boolean | null
          organization_id?: string
          stripe_access_token?: string | null
          stripe_account_id?: string | null
          stripe_default_currency?: string | null
          stripe_display_name?: string | null
          stripe_payouts_enabled?: boolean | null
          stripe_publishable_key?: string | null
          stripe_refresh_token?: string | null
          stripe_secret_key?: string | null
          stripe_user_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_stripe_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_zapier_alert_settings: {
        Row: {
          cooldown_minutes: number
          created_at: string
          enabled: boolean
          failure_threshold: number
          last_alerted_at: string | null
          notify_email: boolean
          notify_inapp: boolean
          organization_id: string
          recipient_email: string | null
          updated_at: string
          window_minutes: number
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          failure_threshold?: number
          last_alerted_at?: string | null
          notify_email?: boolean
          notify_inapp?: boolean
          organization_id: string
          recipient_email?: string | null
          updated_at?: string
          window_minutes?: number
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          failure_threshold?: number
          last_alerted_at?: string | null
          notify_email?: boolean
          notify_inapp?: boolean
          organization_id?: string
          recipient_email?: string | null
          updated_at?: string
          window_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_zapier_alert_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_zapier_webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          webhook_url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          webhook_url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_zapier_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_automations: {
        Row: {
          automation_type: string
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          organization_id: string
          settings: Json | null
          updated_at: string
        }
        Insert: {
          automation_type: string
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          organization_id: string
          settings?: Json | null
          updated_at?: string
        }
        Update: {
          automation_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          organization_id?: string
          settings?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_email_domains: {
        Row: {
          created_at: string
          dns_records: Json | null
          domain_name: string
          id: string
          organization_id: string
          resend_domain_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dns_records?: Json | null
          domain_name: string
          id?: string
          organization_id: string
          resend_domain_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dns_records?: Json | null
          domain_name?: string
          id?: string
          organization_id?: string
          resend_domain_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_email_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_email_settings: {
        Row: {
          created_at: string
          email_footer: string | null
          email_send_method: string
          from_email: string
          from_name: string
          gmail_account_type: string
          id: string
          organization_id: string
          reply_to_email: string | null
          resend_api_key: string | null
          smtp_app_password: string | null
          smtp_email: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_footer?: string | null
          email_send_method?: string
          from_email: string
          from_name: string
          gmail_account_type?: string
          id?: string
          organization_id: string
          reply_to_email?: string | null
          resend_api_key?: string | null
          smtp_app_password?: string | null
          smtp_email?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_footer?: string | null
          email_send_method?: string
          from_email?: string
          from_name?: string
          gmail_account_type?: string
          id?: string
          organization_id?: string
          reply_to_email?: string | null
          resend_api_key?: string | null
          smtp_app_password?: string | null
          smtp_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_email_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invoice_settings: {
        Row: {
          accept_ach: boolean | null
          accept_cards: boolean | null
          accept_cash: boolean | null
          accept_checks: boolean | null
          accept_paypal: boolean | null
          ach_fee_fixed: number | null
          ach_fee_percent: number | null
          card_fee_fixed: number | null
          card_fee_percent: number | null
          created_at: string
          default_billable_hours: number | null
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          accept_ach?: boolean | null
          accept_cards?: boolean | null
          accept_cash?: boolean | null
          accept_checks?: boolean | null
          accept_paypal?: boolean | null
          ach_fee_fixed?: number | null
          ach_fee_percent?: number | null
          card_fee_fixed?: number | null
          card_fee_percent?: number | null
          created_at?: string
          default_billable_hours?: number | null
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          accept_ach?: boolean | null
          accept_cards?: boolean | null
          accept_cash?: boolean | null
          accept_checks?: boolean | null
          accept_paypal?: boolean | null
          ach_fee_fixed?: number | null
          ach_fee_percent?: number | null
          card_fee_fixed?: number | null
          card_fee_percent?: number | null
          created_at?: string
          default_billable_hours?: number | null
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invoice_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_mobile_nav_settings: {
        Row: {
          created_at: string
          icon_overrides: Json
          id: string
          items: Json
          organization_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon_overrides?: Json
          id?: string
          items?: Json
          organization_id: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon_overrides?: Json
          id?: string
          items?: Json
          organization_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_mobile_nav_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_notification_preferences: {
        Row: {
          bell_notifications: Json
          channels: Json
          created_at: string
          notification_matrix: Json
          organization_id: string
          sidebar_badges: Json
          snoozed_until: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bell_notifications?: Json
          channels?: Json
          created_at?: string
          notification_matrix?: Json
          organization_id: string
          sidebar_badges?: Json
          snoozed_until?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bell_notifications?: Json
          channels?: Json
          created_at?: string
          notification_matrix?: Json
          organization_id?: string
          sidebar_badges?: Json
          snoozed_until?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_pricing_settings: {
        Row: {
          booking_form_theme: string
          created_at: string
          demo_mode_enabled: boolean | null
          excluded_room_types: string[]
          form_accent_color: string | null
          form_bg_color: string | null
          form_button_color: string | null
          form_button_text_color: string | null
          form_card_color: string | null
          form_text_color: string | null
          id: string
          loyalty_program_enabled: boolean
          organization_id: string
          pet_fee: number
          pet_toggle_enabled: boolean
          room_reduction_prices: Json
          sales_tax_percent: number | null
          show_addons_on_booking: boolean | null
          show_bed_bath_on_booking: boolean | null
          show_frequency_discount: boolean | null
          show_home_condition: boolean | null
          show_pet_options: boolean | null
          show_sqft_on_booking: boolean | null
          updated_at: string
        }
        Insert: {
          booking_form_theme?: string
          created_at?: string
          demo_mode_enabled?: boolean | null
          excluded_room_types?: string[]
          form_accent_color?: string | null
          form_bg_color?: string | null
          form_button_color?: string | null
          form_button_text_color?: string | null
          form_card_color?: string | null
          form_text_color?: string | null
          id?: string
          loyalty_program_enabled?: boolean
          organization_id: string
          pet_fee?: number
          pet_toggle_enabled?: boolean
          room_reduction_prices?: Json
          sales_tax_percent?: number | null
          show_addons_on_booking?: boolean | null
          show_bed_bath_on_booking?: boolean | null
          show_frequency_discount?: boolean | null
          show_home_condition?: boolean | null
          show_pet_options?: boolean | null
          show_sqft_on_booking?: boolean | null
          updated_at?: string
        }
        Update: {
          booking_form_theme?: string
          created_at?: string
          demo_mode_enabled?: boolean | null
          excluded_room_types?: string[]
          form_accent_color?: string | null
          form_bg_color?: string | null
          form_button_color?: string | null
          form_button_text_color?: string | null
          form_card_color?: string | null
          form_text_color?: string | null
          id?: string
          loyalty_program_enabled?: boolean
          organization_id?: string
          pet_fee?: number
          pet_toggle_enabled?: boolean
          room_reduction_prices?: Json
          sales_tax_percent?: number | null
          show_addons_on_booking?: boolean | null
          show_bed_bath_on_booking?: boolean | null
          show_frequency_discount?: boolean | null
          show_home_condition?: boolean | null
          show_pet_options?: boolean | null
          show_sqft_on_booking?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_pricing_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_sms_settings: {
        Row: {
          created_at: string
          external_booking_webhook_secret: string | null
          id: string
          notify_admin_arrived: boolean
          notify_admin_on_the_way: boolean
          notify_client_arrived: boolean
          notify_client_distance_eta: boolean
          notify_client_on_the_way: boolean
          openphone_api_key: string | null
          openphone_phone_number_id: string | null
          organization_id: string
          reminder_hours_before: number | null
          sms_appointment_reminder: boolean | null
          sms_booking_confirmation: boolean | null
          sms_enabled: boolean | null
          sms_post_booking_upsell: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_booking_webhook_secret?: string | null
          id?: string
          notify_admin_arrived?: boolean
          notify_admin_on_the_way?: boolean
          notify_client_arrived?: boolean
          notify_client_distance_eta?: boolean
          notify_client_on_the_way?: boolean
          openphone_api_key?: string | null
          openphone_phone_number_id?: string | null
          organization_id: string
          reminder_hours_before?: number | null
          sms_appointment_reminder?: boolean | null
          sms_booking_confirmation?: boolean | null
          sms_enabled?: boolean | null
          sms_post_booking_upsell?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_booking_webhook_secret?: string | null
          id?: string
          notify_admin_arrived?: boolean
          notify_admin_on_the_way?: boolean
          notify_client_arrived?: boolean
          notify_client_distance_eta?: boolean
          notify_client_on_the_way?: boolean
          openphone_api_key?: string | null
          openphone_phone_number_id?: string | null
          organization_id?: string
          reminder_hours_before?: number | null
          sms_appointment_reminder?: boolean | null
          sms_booking_confirmation?: boolean | null
          sms_enabled?: boolean | null
          sms_post_booking_upsell?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_sms_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          country_code: string
          created_at: string
          grandfathered_at: string | null
          grandfathered_lifetime: boolean
          id: string
          logo_url: string | null
          name: string
          needs_onboarding: boolean
          onboarding_answers: Json | null
          owner_id: string
          plan_downgrade_date: string | null
          plan_downgrade_scheduled_to: string | null
          plan_tier: string
          plan_type: string | null
          slug: string | null
          stripe_schedule_id: string | null
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          grandfathered_at?: string | null
          grandfathered_lifetime?: boolean
          id?: string
          logo_url?: string | null
          name: string
          needs_onboarding?: boolean
          onboarding_answers?: Json | null
          owner_id: string
          plan_downgrade_date?: string | null
          plan_downgrade_scheduled_to?: string | null
          plan_tier?: string
          plan_type?: string | null
          slug?: string | null
          stripe_schedule_id?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          grandfathered_at?: string | null
          grandfathered_lifetime?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          needs_onboarding?: boolean
          onboarding_answers?: Json | null
          owner_id?: string
          plan_downgrade_date?: string | null
          plan_downgrade_scheduled_to?: string | null
          plan_tier?: string
          plan_type?: string | null
          slug?: string | null
          stripe_schedule_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      page_seo_metadata: {
        Row: {
          canonical_url: string | null
          created_at: string
          id: string
          meta_description: string | null
          no_index: boolean | null
          og_description: string | null
          og_image_url: string | null
          og_title: string | null
          organization_id: string | null
          page_path: string
          seo_title: string | null
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          no_index?: boolean | null
          og_description?: string | null
          og_image_url?: string | null
          og_title?: string | null
          organization_id?: string | null
          page_path: string
          seo_title?: string | null
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          no_index?: boolean | null
          og_description?: string | null
          og_image_url?: string | null
          og_title?: string | null
          organization_id?: string | null
          page_path?: string
          seo_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_seo_metadata_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_evidence: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          device_fingerprint: string | null
          email: string
          id: string
          ip_address: string | null
          metadata: Json | null
          organization_id: string | null
          signup_date: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          three_d_secure_status: string | null
          tos_accepted: boolean | null
          tos_accepted_at: string | null
          tos_version: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          device_fingerprint?: string | null
          email: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          organization_id?: string | null
          signup_date?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          three_d_secure_status?: string | null
          tos_accepted?: boolean | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          device_fingerprint?: string | null
          email?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          organization_id?: string | null
          signup_date?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          three_d_secure_status?: string | null
          tos_accepted?: boolean | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      payroll_audit_log: {
        Row: {
          action: string
          affected_booking_ids: string[] | null
          created_at: string
          details: Json | null
          id: string
          organization_id: string
          period_end: string
          period_start: string
          user_id: string
        }
        Insert: {
          action: string
          affected_booking_ids?: string[] | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          user_id: string
        }
        Update: {
          action?: string
          affected_booking_ids?: string[] | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string | null
          paid_at: string
          paid_by: string
          payment_method: string
          staff_id: string
          stripe_transfer_id: string | null
          week_start: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          paid_at?: string
          paid_by: string
          payment_method?: string
          staff_id: string
          stripe_transfer_id?: string | null
          week_start: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          paid_at?: string
          paid_by?: string
          payment_method?: string
          staff_id?: string
          stripe_transfer_id?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settings: {
        Row: {
          created_at: string
          hours_absolute_ceiling: number
          hours_overage_cap_ratio: number
          id: string
          include_taxes_in_pay_base: boolean
          include_tips_in_pay_base: boolean
          labor_percent_warning_threshold: number
          margin_percent_good_threshold: number
          organization_id: string
          payroll_week_start_day: string
          processing_fee_flat: number
          processing_fee_mode: string
          processing_fee_percent: number
          updated_at: string
          vendor_cost_flat: number | null
          vendor_cost_mode: string
          vendor_cost_percent: number | null
        }
        Insert: {
          created_at?: string
          hours_absolute_ceiling?: number
          hours_overage_cap_ratio?: number
          id?: string
          include_taxes_in_pay_base?: boolean
          include_tips_in_pay_base?: boolean
          labor_percent_warning_threshold?: number
          margin_percent_good_threshold?: number
          organization_id: string
          payroll_week_start_day?: string
          processing_fee_flat?: number
          processing_fee_mode?: string
          processing_fee_percent?: number
          updated_at?: string
          vendor_cost_flat?: number | null
          vendor_cost_mode?: string
          vendor_cost_percent?: number | null
        }
        Update: {
          created_at?: string
          hours_absolute_ceiling?: number
          hours_overage_cap_ratio?: number
          id?: string
          include_taxes_in_pay_base?: boolean
          include_tips_in_pay_base?: boolean
          labor_percent_warning_threshold?: number
          margin_percent_good_threshold?: number
          organization_id?: string
          payroll_week_start_day?: string
          processing_fee_flat?: number
          processing_fee_mode?: string
          processing_fee_percent?: number
          updated_at?: string
          vendor_cost_flat?: number | null
          vendor_cost_mode?: string
          vendor_cost_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      peer_benchmark_snapshots: {
        Row: {
          avg_price: number | null
          avg_rating: number | null
          bookings_per_org: number | null
          cancel_rate: number | null
          cohort_key: string
          cohort_type: string
          created_at: string
          id: string
          median_price: number | null
          noshow_rate: number | null
          org_count: number
          p25_price: number | null
          p75_price: number | null
          period_start: string
          recurring_share: number | null
          repeat_rate: number | null
          review_rate: number | null
          service_bucket: string
        }
        Insert: {
          avg_price?: number | null
          avg_rating?: number | null
          bookings_per_org?: number | null
          cancel_rate?: number | null
          cohort_key: string
          cohort_type: string
          created_at?: string
          id?: string
          median_price?: number | null
          noshow_rate?: number | null
          org_count?: number
          p25_price?: number | null
          p75_price?: number | null
          period_start: string
          recurring_share?: number | null
          repeat_rate?: number | null
          review_rate?: number | null
          service_bucket?: string
        }
        Update: {
          avg_price?: number | null
          avg_rating?: number | null
          bookings_per_org?: number | null
          cancel_rate?: number | null
          cohort_key?: string
          cohort_type?: string
          created_at?: string
          id?: string
          median_price?: number | null
          noshow_rate?: number | null
          org_count?: number
          p25_price?: number | null
          p75_price?: number | null
          period_start?: string
          recurring_share?: number | null
          repeat_rate?: number | null
          review_rate?: number | null
          service_bucket?: string
        }
        Relationships: []
      }
      platform_notifications: {
        Row: {
          created_at: string | null
          id: string
          message_preview: string | null
          metadata: Json | null
          notification_type: string
          org_id: string | null
          sent_at: string | null
          sent_to: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_preview?: string | null
          metadata?: Json | null
          notification_type: string
          org_id?: string | null
          sent_at?: string | null
          sent_to: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_preview?: string | null
          metadata?: Json | null
          notification_type?: string
          org_id?: string | null
          sent_at?: string | null
          sent_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
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
      pnl_settings: {
        Row: {
          annual_revenue_goal: number | null
          avg_job_size_goal: number | null
          churn_rate_goal: number | null
          closing_rate_goal: number | null
          contractor_percent: number | null
          created_at: string
          credit_card_percent: number | null
          direct_mail_spend: Json | null
          facebook_ads_spend: Json | null
          first_time_to_recurring_goal: number | null
          fixed_cost_goal: number | null
          fixed_overhead_items: Json | null
          goal_first_time_revenue_amount: number | null
          goal_repeat_revenue_amount: number | null
          goal_repeat_revenue_percent: number | null
          google_lsa_spend: Json | null
          id: string
          last_year_revenue: number | null
          local_marketing_spend: Json | null
          marketing_channel_names: Json
          marketing_percent_of_revenue: number | null
          monthly_first_time_goals: Json | null
          monthly_fixed_cost_goals: Json | null
          monthly_inbound_leads_goals: Json | null
          monthly_marketing_budget: Json | null
          monthly_recurring_goals: Json | null
          monthly_sales_goals: Json | null
          net_profit_goal_percent: number | null
          organization_id: string | null
          other_online_spend: Json | null
          recruiting_costs: Json | null
          refunds_percent: number | null
          target_cpa: number | null
          target_cpl: number | null
          updated_at: string
          variable_overhead_items: Json | null
          year: number
        }
        Insert: {
          annual_revenue_goal?: number | null
          avg_job_size_goal?: number | null
          churn_rate_goal?: number | null
          closing_rate_goal?: number | null
          contractor_percent?: number | null
          created_at?: string
          credit_card_percent?: number | null
          direct_mail_spend?: Json | null
          facebook_ads_spend?: Json | null
          first_time_to_recurring_goal?: number | null
          fixed_cost_goal?: number | null
          fixed_overhead_items?: Json | null
          goal_first_time_revenue_amount?: number | null
          goal_repeat_revenue_amount?: number | null
          goal_repeat_revenue_percent?: number | null
          google_lsa_spend?: Json | null
          id?: string
          last_year_revenue?: number | null
          local_marketing_spend?: Json | null
          marketing_channel_names?: Json
          marketing_percent_of_revenue?: number | null
          monthly_first_time_goals?: Json | null
          monthly_fixed_cost_goals?: Json | null
          monthly_inbound_leads_goals?: Json | null
          monthly_marketing_budget?: Json | null
          monthly_recurring_goals?: Json | null
          monthly_sales_goals?: Json | null
          net_profit_goal_percent?: number | null
          organization_id?: string | null
          other_online_spend?: Json | null
          recruiting_costs?: Json | null
          refunds_percent?: number | null
          target_cpa?: number | null
          target_cpl?: number | null
          updated_at?: string
          variable_overhead_items?: Json | null
          year?: number
        }
        Update: {
          annual_revenue_goal?: number | null
          avg_job_size_goal?: number | null
          churn_rate_goal?: number | null
          closing_rate_goal?: number | null
          contractor_percent?: number | null
          created_at?: string
          credit_card_percent?: number | null
          direct_mail_spend?: Json | null
          facebook_ads_spend?: Json | null
          first_time_to_recurring_goal?: number | null
          fixed_cost_goal?: number | null
          fixed_overhead_items?: Json | null
          goal_first_time_revenue_amount?: number | null
          goal_repeat_revenue_amount?: number | null
          goal_repeat_revenue_percent?: number | null
          google_lsa_spend?: Json | null
          id?: string
          last_year_revenue?: number | null
          local_marketing_spend?: Json | null
          marketing_channel_names?: Json
          marketing_percent_of_revenue?: number | null
          monthly_first_time_goals?: Json | null
          monthly_fixed_cost_goals?: Json | null
          monthly_inbound_leads_goals?: Json | null
          monthly_marketing_budget?: Json | null
          monthly_recurring_goals?: Json | null
          monthly_sales_goals?: Json | null
          net_profit_goal_percent?: number | null
          organization_id?: string | null
          other_online_spend?: Json | null
          recruiting_costs?: Json | null
          refunds_percent?: number | null
          target_cpa?: number | null
          target_cpl?: number | null
          updated_at?: string
          variable_overhead_items?: Json | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "pnl_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_feedback: {
        Row: {
          admin_note: string | null
          app_area: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          organization_id: string | null
          reply_email: string | null
          sender_name: string | null
          severity: string | null
          topic: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          app_area?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          organization_id?: string | null
          reply_email?: string | null
          sender_name?: string | null
          severity?: string | null
          topic: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          app_area?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          organization_id?: string | null
          reply_email?: string | null
          sender_name?: string | null
          severity?: string | null
          topic?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tour_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          organization_id: string | null
          step_number: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          step_number?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          step_number?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_tour_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          billing_cycle: string | null
          created_at: string
          email: string | null
          email_unsubscribed: boolean
          email_unsubscribed_at: string | null
          full_name: string | null
          id: string
          phone: string | null
          subscription_status: string
          subscription_tier: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          billing_cycle?: string | null
          created_at?: string
          email?: string | null
          email_unsubscribed?: boolean
          email_unsubscribed_at?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          subscription_status?: string
          subscription_tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          billing_cycle?: string | null
          created_at?: string
          email?: string | null
          email_unsubscribed?: boolean
          email_unsubscribed_at?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          subscription_status?: string
          subscription_tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      property_notes: {
        Row: {
          access_instructions: string | null
          alarm_code: string | null
          created_at: string
          customer_id: string
          gate_code: string | null
          has_pets: boolean
          id: string
          notes: string | null
          organization_id: string
          parking_notes: string | null
          pet_notes: string | null
          updated_at: string
        }
        Insert: {
          access_instructions?: string | null
          alarm_code?: string | null
          created_at?: string
          customer_id: string
          gate_code?: string | null
          has_pets?: boolean
          id?: string
          notes?: string | null
          organization_id: string
          parking_notes?: string | null
          pet_notes?: string | null
          updated_at?: string
        }
        Update: {
          access_instructions?: string | null
          alarm_code?: string | null
          created_at?: string
          customer_id?: string
          gate_code?: string | null
          has_pets?: boolean
          id?: string
          notes?: string | null
          organization_id?: string
          parking_notes?: string | null
          pet_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          address: string | null
          bathrooms: string | null
          bedrooms: string | null
          city: string | null
          created_at: string
          customer_id: string | null
          discount_amount: number | null
          discount_percent: number | null
          extras: Json | null
          id: string
          lead_id: string | null
          notes: string | null
          organization_id: string | null
          quote_number: number
          service_id: string | null
          square_footage: string | null
          state: string | null
          status: string | null
          subtotal: number
          total_amount: number
          updated_at: string
          valid_until: string | null
          zip_code: string | null
        }
        Insert: {
          accepted_at?: string | null
          address?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          extras?: Json | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string | null
          quote_number?: number
          service_id?: string | null
          square_footage?: string | null
          state?: string | null
          status?: string | null
          subtotal?: number
          total_amount?: number
          updated_at?: string
          valid_until?: string | null
          zip_code?: string | null
        }
        Update: {
          accepted_at?: string | null
          address?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          extras?: Json | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string | null
          quote_number?: number
          service_id?: string | null
          square_footage?: string | null
          state?: string | null
          status?: string | null
          subtotal?: number
          total_amount?: number
          updated_at?: string
          valid_until?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      rebooking_reminder_queue: {
        Row: {
          booking_id: string
          cancelled: boolean
          cancelled_reason: string | null
          created_at: string
          customer_id: string
          defer_count: number
          deferred_until: string | null
          error: string | null
          id: string
          organization_id: string
          send_at: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          booking_id: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          customer_id: string
          defer_count?: number
          deferred_until?: string | null
          error?: string | null
          id?: string
          organization_id: string
          send_at: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          booking_id?: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          customer_id?: string
          defer_count?: number
          deferred_until?: string | null
          error?: string | null
          id?: string
          organization_id?: string
          send_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rebooking_reminder_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebooking_reminder_queue_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebooking_reminder_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_bookings: {
        Row: {
          address: string | null
          bathrooms: string | null
          bedrooms: string | null
          city: string | null
          created_at: string
          customer_id: string | null
          day_prices: Json | null
          day_services: Json | null
          ends_at: string | null
          extras: Json | null
          frequency: string
          id: string
          is_active: boolean
          last_generated_at: string | null
          next_scheduled_at: string | null
          notes: string | null
          organization_id: string | null
          preferred_date_of_month: number | null
          preferred_day: number | null
          preferred_time: string | null
          recurring_days_of_week: number[] | null
          service_id: string | null
          square_footage: string | null
          staff_id: string | null
          state: string | null
          total_amount: number
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          day_prices?: Json | null
          day_services?: Json | null
          ends_at?: string | null
          extras?: Json | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          next_scheduled_at?: string | null
          notes?: string | null
          organization_id?: string | null
          preferred_date_of_month?: number | null
          preferred_day?: number | null
          preferred_time?: string | null
          recurring_days_of_week?: number[] | null
          service_id?: string | null
          square_footage?: string | null
          staff_id?: string | null
          state?: string | null
          total_amount?: number
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          bathrooms?: string | null
          bedrooms?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string | null
          day_prices?: Json | null
          day_services?: Json | null
          ends_at?: string | null
          extras?: Json | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          next_scheduled_at?: string | null
          notes?: string | null
          organization_id?: string | null
          preferred_date_of_month?: number | null
          preferred_day?: number | null
          preferred_time?: string | null
          recurring_days_of_week?: number[] | null
          service_id?: string | null
          square_footage?: string | null
          staff_id?: string | null
          state?: string | null
          total_amount?: number
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_offer_queue: {
        Row: {
          booking_id: string
          cancelled: boolean
          cancelled_reason: string | null
          created_at: string
          customer_id: string
          defer_count: number
          deferred_until: string | null
          error: string | null
          id: string
          organization_id: string
          send_at: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          booking_id: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          customer_id: string
          defer_count?: number
          deferred_until?: string | null
          error?: string | null
          id?: string
          organization_id: string
          send_at: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          booking_id?: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          customer_id?: string
          defer_count?: number
          deferred_until?: string | null
          error?: string | null
          id?: string
          organization_id?: string
          send_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_offer_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_offer_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          completed_at: string | null
          created_at: string
          credit_amount: number
          credit_awarded: boolean | null
          expires_at: string | null
          id: string
          organization_id: string | null
          referral_code: string
          referred_customer_id: string | null
          referred_email: string
          referred_name: string | null
          referrer_customer_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          credit_amount?: number
          credit_awarded?: boolean | null
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          referral_code: string
          referred_customer_id?: string | null
          referred_email: string
          referred_name?: string | null
          referrer_customer_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          credit_amount?: number
          credit_awarded?: boolean | null
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          referral_code?: string
          referred_customer_id?: string | null
          referred_email?: string
          referred_name?: string | null
          referrer_customer_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_customer_id_fkey"
            columns: ["referred_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_customer_id_fkey"
            columns: ["referrer_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_id: string | null
          google_review_url: string | null
          id: string
          opened_at: string | null
          organization_id: string | null
          platform: string | null
          rating: number | null
          responded_at: string | null
          review_link_token: string | null
          review_text: string | null
          sent_at: string | null
          staff_id: string | null
          status: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          google_review_url?: string | null
          id?: string
          opened_at?: string | null
          organization_id?: string | null
          platform?: string | null
          rating?: number | null
          responded_at?: string | null
          review_link_token?: string | null
          review_text?: string | null
          sent_at?: string | null
          staff_id?: string | null
          status?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          google_review_url?: string | null
          id?: string
          opened_at?: string | null
          organization_id?: string | null
          platform?: string | null
          rating?: number | null
          responded_at?: string | null
          review_link_token?: string | null
          review_text?: string | null
          sent_at?: string | null
          staff_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      score_claim_audit: {
        Row: {
          company_id: string
          company_slug: string
          created_at: string
          email: string | null
          id: string
          ip_address: string | null
          source: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          company_slug: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          source?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          company_slug?: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      score_claim_requests: {
        Row: {
          approved_organization_id: string | null
          claimant_email: string
          claimant_name: string
          claimant_phone: string | null
          company_id: string
          created_at: string
          id: string
          message: string | null
          reviewed_at: string | null
          status: string
        }
        Insert: {
          approved_organization_id?: string | null
          claimant_email: string
          claimant_name: string
          claimant_phone?: string | null
          company_id: string
          created_at?: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          status?: string
        }
        Update: {
          approved_organization_id?: string | null
          claimant_email?: string
          claimant_name?: string
          claimant_phone?: string | null
          company_id?: string
          created_at?: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_claim_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "score_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      score_companies: {
        Row: {
          city: string | null
          city_rank: number | null
          city_slug: string | null
          city_total: number | null
          claimed: boolean
          claimed_at: string | null
          claimed_organization_id: string | null
          claimed_user_id: string | null
          created_at: string
          formatted_address: string | null
          google_place_id: string | null
          google_rating: number | null
          google_review_count: number | null
          id: string
          last_scored_at: string | null
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          score: number | null
          score_grade: string | null
          slug: string
          source: string
          state: string | null
          updated_at: string
          website: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          city_rank?: number | null
          city_slug?: string | null
          city_total?: number | null
          claimed?: boolean
          claimed_at?: string | null
          claimed_organization_id?: string | null
          claimed_user_id?: string | null
          created_at?: string
          formatted_address?: string | null
          google_place_id?: string | null
          google_rating?: number | null
          google_review_count?: number | null
          id?: string
          last_scored_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          score?: number | null
          score_grade?: string | null
          slug: string
          source?: string
          state?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          city_rank?: number | null
          city_slug?: string | null
          city_total?: number | null
          claimed?: boolean
          claimed_at?: string | null
          claimed_organization_id?: string | null
          claimed_user_id?: string | null
          created_at?: string
          formatted_address?: string | null
          google_place_id?: string | null
          google_rating?: number | null
          google_review_count?: number | null
          id?: string
          last_scored_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          score?: number | null
          score_grade?: string | null
          slug?: string
          source?: string
          state?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      score_company_metrics: {
        Row: {
          ai_tips: Json | null
          company_id: string
          computed_at: string
          id: string
          review_themes: Json | null
          reviews_score: number | null
          sentiment_communication: number | null
          sentiment_evidence: Json
          sentiment_quality: number | null
          sentiment_reliability: number | null
          sentiment_value: number | null
          website_has_booking: boolean | null
          website_has_https: boolean | null
          website_load_ms: number | null
          website_mobile_friendly: boolean | null
          website_score: number | null
        }
        Insert: {
          ai_tips?: Json | null
          company_id: string
          computed_at?: string
          id?: string
          review_themes?: Json | null
          reviews_score?: number | null
          sentiment_communication?: number | null
          sentiment_evidence?: Json
          sentiment_quality?: number | null
          sentiment_reliability?: number | null
          sentiment_value?: number | null
          website_has_booking?: boolean | null
          website_has_https?: boolean | null
          website_load_ms?: number | null
          website_mobile_friendly?: boolean | null
          website_score?: number | null
        }
        Update: {
          ai_tips?: Json | null
          company_id?: string
          computed_at?: string
          id?: string
          review_themes?: Json | null
          reviews_score?: number | null
          sentiment_communication?: number | null
          sentiment_evidence?: Json
          sentiment_quality?: number | null
          sentiment_reliability?: number | null
          sentiment_value?: number | null
          website_has_booking?: boolean | null
          website_has_https?: boolean | null
          website_load_ms?: number | null
          website_mobile_friendly?: boolean | null
          website_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "score_company_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "score_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      score_top_cities: {
        Row: {
          city: string
          city_slug: string
          created_at: string
          display_order: number
          id: string
          is_featured: boolean
          state: string
        }
        Insert: {
          city: string
          city_slug: string
          created_at?: string
          display_order?: number
          id?: string
          is_featured?: boolean
          state: string
        }
        Update: {
          city?: string
          city_slug?: string
          created_at?: string
          display_order?: number
          id?: string
          is_featured?: boolean
          state?: string
        }
        Relationships: []
      }
      sentry_dismissed_issues: {
        Row: {
          created_at: string
          dismissed_at: string
          dismissed_by: string | null
          issue_id: string
          last_seen_at_dismiss: string | null
        }
        Insert: {
          created_at?: string
          dismissed_at?: string
          dismissed_by?: string | null
          issue_id: string
          last_seen_at_dismiss?: string | null
        }
        Update: {
          created_at?: string
          dismissed_at?: string
          dismissed_by?: string | null
          issue_id?: string
          last_seen_at_dismiss?: string | null
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_pricing: {
        Row: {
          bedroom_pricing: Json | null
          created_at: string
          extras: Json | null
          home_condition_options: Json | null
          id: string
          minimum_price: number | null
          organization_id: string
          pet_options: Json | null
          pricing_lock_reason: string | null
          pricing_locked: boolean
          service_id: string
          sqft_prices: Json | null
          updated_at: string
        }
        Insert: {
          bedroom_pricing?: Json | null
          created_at?: string
          extras?: Json | null
          home_condition_options?: Json | null
          id?: string
          minimum_price?: number | null
          organization_id: string
          pet_options?: Json | null
          pricing_lock_reason?: string | null
          pricing_locked?: boolean
          service_id: string
          sqft_prices?: Json | null
          updated_at?: string
        }
        Update: {
          bedroom_pricing?: Json | null
          created_at?: string
          extras?: Json | null
          home_condition_options?: Json | null
          id?: string
          minimum_price?: number | null
          organization_id?: string
          pet_options?: Json | null
          pricing_lock_reason?: string | null
          pricing_locked?: boolean
          service_id?: string
          sqft_prices?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_pricing_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category_id: string | null
          created_at: string
          deposit_amount: number | null
          description: string | null
          display_order: number
          duration: number
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          organization_id: string | null
          price: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          deposit_amount?: number | null
          description?: string | null
          display_order?: number
          duration?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          organization_id?: string | null
          price?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          deposit_amount?: number | null
          description?: string | null
          display_order?: number
          duration?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          organization_id?: string | null
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      short_urls: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string | null
          target_url: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          target_url: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_urls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      sms_conversations: {
        Row: {
          conversation_type: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          last_message_at: string
          metadata: Json | null
          organization_id: string
          unread_count: number | null
          updated_at: string
        }
        Insert: {
          conversation_type?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          last_message_at?: string
          metadata?: Json | null
          organization_id: string
          unread_count?: number | null
          updated_at?: string
        }
        Update: {
          conversation_type?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          last_message_at?: string
          metadata?: Json | null
          organization_id?: string
          unread_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          delivered_at: string | null
          delivery_status: string | null
          direction: string
          id: string
          media_urls: string[] | null
          openphone_message_id: string | null
          organization_id: string
          sender_user_id: string | null
          sent_at: string
          status: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          direction: string
          id?: string
          media_urls?: string[] | null
          openphone_message_id?: string | null
          organization_id: string
          sender_user_id?: string | null
          sent_at?: string
          status?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          direction?: string
          id?: string
          media_urls?: string[] | null
          openphone_message_id?: string | null
          organization_id?: string
          sender_user_id?: string | null
          sent_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sms_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_send_log: {
        Row: {
          admin_user_id: string | null
          created_at: string
          customer_email_hash: string | null
          customer_phone: string | null
          details: Json | null
          id: string
          organization_id: string
          sms_type: string
          status: string
        }
        Insert: {
          admin_user_id?: string | null
          created_at?: string
          customer_email_hash?: string | null
          customer_phone?: string | null
          details?: Json | null
          id?: string
          organization_id: string
          sms_type: string
          status?: string
        }
        Update: {
          admin_user_id?: string | null
          created_at?: string
          customer_email_hash?: string | null
          customer_phone?: string | null
          details?: Json | null
          id?: string
          organization_id?: string
          sms_type?: string
          status?: string
        }
        Relationships: []
      }
      sms_suppressions: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          phone: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          phone: string
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          phone?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          organization_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          avatar_url: string | null
          base_wage: number | null
          bio: string | null
          calendar_color: string | null
          created_at: string
          default_hours: number | null
          ein: string | null
          email: string
          home_address: string | null
          home_latitude: number | null
          home_longitude: number | null
          hourly_rate: number | null
          id: string
          is_active: boolean
          location_permission_status: string | null
          location_permission_updated_at: string | null
          name: string
          organization_id: string | null
          percentage_rate: number | null
          phone: string | null
          ssn_last4: string | null
          tax_classification: string | null
          tax_document_url: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          base_wage?: number | null
          bio?: string | null
          calendar_color?: string | null
          created_at?: string
          default_hours?: number | null
          ein?: string | null
          email: string
          home_address?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          location_permission_status?: string | null
          location_permission_updated_at?: string | null
          name: string
          organization_id?: string | null
          percentage_rate?: number | null
          phone?: string | null
          ssn_last4?: string | null
          tax_classification?: string | null
          tax_document_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          base_wage?: number | null
          bio?: string | null
          calendar_color?: string | null
          created_at?: string
          default_hours?: number | null
          ein?: string | null
          email?: string
          home_address?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          location_permission_status?: string | null
          location_permission_updated_at?: string | null
          name?: string
          organization_id?: string | null
          percentage_rate?: number | null
          phone?: string | null
          ssn_last4?: string | null
          tax_classification?: string | null
          tax_document_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          admin_note: string | null
          document_type: string
          file_name: string
          file_path: string
          id: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          document_type?: string
          file_name: string
          file_path: string
          id?: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          status?: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          document_type?: string
          file_name?: string
          file_path?: string
          id?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          status?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_event_notifications: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_read: boolean | null
          message: string | null
          organization_id: string
          staff_id: string
          title: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          organization_id: string
          staff_id: string
          title: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          organization_id?: string
          staff_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_event_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_event_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_event_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_payout_accounts: {
        Row: {
          account_holder_name: string | null
          account_status: string
          bank_last4: string | null
          charges_enabled: boolean | null
          created_at: string
          details_submitted: boolean | null
          disabled_reason: string | null
          id: string
          last_webhook_at: string | null
          onboarding_url: string | null
          organization_id: string
          payout_resolved_toast_shown: boolean
          payouts_enabled: boolean | null
          requirements_currently_due: Json | null
          requirements_pending_verification: Json | null
          staff_id: string
          stripe_account_id: string | null
          stripe_requirements_errors: Json | null
          updated_at: string
        }
        Insert: {
          account_holder_name?: string | null
          account_status?: string
          bank_last4?: string | null
          charges_enabled?: boolean | null
          created_at?: string
          details_submitted?: boolean | null
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          onboarding_url?: string | null
          organization_id: string
          payout_resolved_toast_shown?: boolean
          payouts_enabled?: boolean | null
          requirements_currently_due?: Json | null
          requirements_pending_verification?: Json | null
          staff_id: string
          stripe_account_id?: string | null
          stripe_requirements_errors?: Json | null
          updated_at?: string
        }
        Update: {
          account_holder_name?: string | null
          account_status?: string
          bank_last4?: string | null
          charges_enabled?: boolean | null
          created_at?: string
          details_submitted?: boolean | null
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          onboarding_url?: string | null
          organization_id?: string
          payout_resolved_toast_shown?: boolean
          payouts_enabled?: boolean | null
          requirements_currently_due?: Json | null
          requirements_pending_verification?: Json | null
          staff_id?: string
          stripe_account_id?: string | null
          stripe_requirements_errors?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_payout_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payout_accounts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payout_accounts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_services: {
        Row: {
          id: string
          service_id: string
          staff_id: string
        }
        Insert: {
          id?: string
          service_id: string
          staff_id: string
        }
        Update: {
          id?: string
          service_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_services_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_services_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_signable_documents: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          file_name: string
          file_path: string
          id: string
          is_active: boolean
          organization_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_name: string
          file_path: string
          id?: string
          is_active?: boolean
          organization_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_signable_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_signatures: {
        Row: {
          id: string
          ip_address: string | null
          organization_id: string
          signable_document_id: string
          signature_data: string
          signature_type: string
          signed_at: string
          signed_pdf_path: string | null
          staff_id: string
          user_id: string
        }
        Insert: {
          id?: string
          ip_address?: string | null
          organization_id: string
          signable_document_id: string
          signature_data: string
          signature_type?: string
          signed_at?: string
          signed_pdf_path?: string | null
          staff_id: string
          user_id: string
        }
        Update: {
          id?: string
          ip_address?: string | null
          organization_id?: string
          signable_document_id?: string
          signature_data?: string
          signature_type?: string
          signed_at?: string
          signed_pdf_path?: string | null
          staff_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_signatures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_signatures_signable_document_id_fkey"
            columns: ["signable_document_id"]
            isOneToOne: false
            referencedRelation: "staff_signable_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_signatures_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_signatures_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_requirement_notifications: {
        Row: {
          account_link_url: string | null
          banner_shown: boolean
          created_at: string
          detected_at: string
          email_sent_at: string | null
          email_sent_count: number
          email_status: string
          id: string
          in_app_notified: boolean
          last_emailed_at: string | null
          link_expires_at: string | null
          needs_manual_followup: boolean
          organization_id: string
          requirement_type: string
          resolved_at: string | null
          staff_id: string
          stripe_requirement_codes: string[]
          updated_at: string
        }
        Insert: {
          account_link_url?: string | null
          banner_shown?: boolean
          created_at?: string
          detected_at?: string
          email_sent_at?: string | null
          email_sent_count?: number
          email_status?: string
          id?: string
          in_app_notified?: boolean
          last_emailed_at?: string | null
          link_expires_at?: string | null
          needs_manual_followup?: boolean
          organization_id: string
          requirement_type: string
          resolved_at?: string | null
          staff_id: string
          stripe_requirement_codes?: string[]
          updated_at?: string
        }
        Update: {
          account_link_url?: string | null
          banner_shown?: boolean
          created_at?: string
          detected_at?: string
          email_sent_at?: string | null
          email_sent_count?: number
          email_status?: string
          id?: string
          in_app_notified?: boolean
          last_emailed_at?: string | null
          link_expires_at?: string | null
          needs_manual_followup?: boolean
          organization_id?: string
          requirement_type?: string
          resolved_at?: string | null
          staff_id?: string
          stripe_requirement_codes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_requirement_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_requirement_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_requirement_notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_reset_history: {
        Row: {
          created_at: string
          id: string
          initiated_by: string
          initiated_by_user_id: string | null
          new_stripe_account_id: string | null
          organization_id: string
          previous_stripe_account_id: string | null
          reason: string | null
          staff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          new_stripe_account_id?: string | null
          organization_id: string
          previous_stripe_account_id?: string | null
          reason?: string | null
          staff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          new_stripe_account_id?: string | null
          organization_id?: string
          previous_stripe_account_id?: string | null
          reason?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_reset_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_reset_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_reset_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_subscriptions: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          metadata: Json
          organization_id: string
          plan: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
          source: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
          source: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
          source?: string
        }
        Relationships: []
      }
      subscription_pauses: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          pause_months: number
          paused_at: string
          reminder_sent_at: string | null
          resume_date: string
          resumed_at: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          pause_months: number
          paused_at?: string
          reminder_sent_at?: string | null
          resume_date: string
          resumed_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          pause_months?: number
          paused_at?: string
          reminder_sent_at?: string | null
          resume_date?: string
          resumed_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_reminder_log: {
        Row: {
          email: string | null
          id: string
          period_end_sec: number
          sent_at: string
          stripe_customer_id: string | null
          stripe_subscription_id: string
        }
        Insert: {
          email?: string | null
          id?: string
          period_end_sec: number
          sent_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id: string
        }
        Update: {
          email?: string | null
          id?: string
          period_end_sec?: number
          sent_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          error_message: string | null
          id: string
          organization_id: string | null
          resource_id: string | null
          resource_type: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          success?: boolean
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          level: string
          message: string
          organization_id: string | null
          request_id: string | null
          source: string
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message: string
          organization_id?: string | null
          request_id?: string | null
          source: string
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message?: string
          organization_id?: string | null
          request_id?: string | null
          source?: string
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_and_notes: {
        Row: {
          content: string
          created_at: string
          due_date: string | null
          id: string
          is_completed: boolean | null
          last_reset_at: string | null
          organization_id: string | null
          sort_order: number | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          last_reset_at?: string | null
          organization_id?: string | null
          sort_order?: number | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          due_date?: string | null
          id?: string
          is_completed?: boolean | null
          last_reset_at?: string | null
          organization_id?: string | null
          sort_order?: number | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_and_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          booking_id: string | null
          channel: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          organization_id: string | null
          sender_id: string
          sender_type: string
        }
        Insert: {
          booking_id?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          organization_id?: string | null
          sender_id: string
          sender_type: string
        }
        Update: {
          booking_id?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          organization_id?: string | null
          sender_id?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          end_date: string
          id: string
          organization_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          end_date: string
          id?: string
          organization_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          end_date?: string
          id?: string
          organization_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          amount: number | null
          booking_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          organization_id: string
          paid_at: string | null
          payment_intent_id: string | null
          sms_sent_at: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          booking_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          organization_id: string
          paid_at?: string | null
          payment_intent_id?: string | null
          sms_sent_at?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          booking_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          organization_id?: string
          paid_at?: string | null
          payment_intent_id?: string | null
          sms_sent_at?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tos_acceptances: {
        Row: {
          accepted: boolean
          accepted_at: string
          email: string
          id: string
          ip_address: string | null
          tos_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted?: boolean
          accepted_at?: string
          email: string
          id?: string
          ip_address?: string | null
          tos_version?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted?: boolean
          accepted_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          tos_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_page_views: {
        Row: {
          id: string
          page_path: string
          page_title: string | null
          session_id: string | null
          user_email: string | null
          user_id: string
          visited_at: string
        }
        Insert: {
          id?: string
          page_path: string
          page_title?: string | null
          session_id?: string | null
          user_email?: string | null
          user_id: string
          visited_at?: string
        }
        Update: {
          id?: string
          page_path?: string
          page_title?: string | null
          session_id?: string | null
          user_email?: string | null
          user_id?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_page_views_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "user_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          preference_key: string
          preference_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          preference_key: string
          preference_value: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          preference_key?: string
          preference_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          is_active: boolean | null
          platform: string | null
          session_end: string | null
          session_start: string
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_active?: boolean | null
          platform?: string | null
          session_end?: string | null
          session_start?: string
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_active?: boolean | null
          platform?: string | null
          session_end?: string | null
          session_start?: string
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      winback_drip_log: {
        Row: {
          customer_id: string | null
          id: string
          organization_id: string
          sent_at: string | null
          step: number
        }
        Insert: {
          customer_id?: string | null
          id?: string
          organization_id: string
          sent_at?: string | null
          step: number
        }
        Update: {
          customer_id?: string | null
          id?: string
          organization_id?: string
          sent_at?: string | null
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "winback_drip_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      winback_offers: {
        Row: {
          claimed_at: string | null
          coupon_id: string | null
          created_at: string
          declined_at: string | null
          id: string
          offer_type: string
          organization_id: string | null
          shown_at: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          declined_at?: string | null
          id?: string
          offer_type: string
          organization_id?: string | null
          shown_at?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          coupon_id?: string | null
          created_at?: string
          declined_at?: string | null
          id?: string
          offer_type?: string
          organization_id?: string | null
          shown_at?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      working_hours: {
        Row: {
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean
          organization_id: string
          staff_id: string | null
          start_time: string
        }
        Insert: {
          day_of_week: number
          end_time: string
          id?: string
          is_available?: boolean
          organization_id: string
          staff_id?: string | null
          start_time: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean
          organization_id?: string
          staff_id?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      zapier_dispatch_log: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          organization_id: string
          payload: Json | null
          status_code: number | null
          success: boolean
          webhook_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          organization_id: string
          payload?: Json | null
          status_code?: number | null
          success?: boolean
          webhook_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          status_code?: number | null
          success?: boolean
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zapier_dispatch_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zapier_dispatch_log_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "org_zapier_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      billing_monthly_summary: {
        Row: {
          active_subscriptions: number | null
          cash_cents: number | null
          churned_involuntary: number | null
          churned_voluntary: number | null
          gap_cents: number | null
          month: string | null
          mrr_cents: number | null
          proration_cents: number | null
          refund_cents: number | null
        }
        Relationships: []
      }
      billing_plan_payers: {
        Row: {
          confidence_worst: string | null
          customer_email: string | null
          first_payment_at: string | null
          gross_cents: number | null
          last_payment_at: string | null
          net_cash_cents: number | null
          organization_id: string | null
          organization_name: string | null
          payment_events: number | null
          reversal_cents: number | null
          reversal_events: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_revenue_by_confidence: {
        Row: {
          confidence: string | null
          events: number | null
          gross_cents: number | null
          month: string | null
          net_cash_cents: number | null
          payment_events: number | null
          reversal_cents: number | null
          reversal_events: number | null
          stream: string | null
        }
        Relationships: []
      }
      client_portal_users_safe: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string | null
          is_active: boolean | null
          last_login_at: string | null
          must_change_password: boolean | null
          organization_id: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          organization_id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          organization_id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_safe: {
        Row: {
          avatar_url: string | null
          base_wage: number | null
          bio: string | null
          created_at: string | null
          ein: string | null
          email: string | null
          hourly_rate: number | null
          id: string | null
          is_active: boolean | null
          name: string | null
          organization_id: string | null
          percentage_rate: number | null
          phone: string | null
          ssn_last4: string | null
          tax_classification: string | null
          tax_document_url: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          base_wage?: never
          bio?: string | null
          created_at?: string | null
          ein?: never
          email?: string | null
          hourly_rate?: never
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          organization_id?: string | null
          percentage_rate?: never
          phone?: string | null
          ssn_last4?: never
          tax_classification?: never
          tax_document_url?: never
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          base_wage?: never
          bio?: string | null
          created_at?: string | null
          ein?: never
          email?: string | null
          hourly_rate?: never
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          organization_id?: string | null
          percentage_rate?: never
          phone?: string | null
          ssn_last4?: never
          tax_classification?: never
          tax_document_url?: never
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_client_portal_location: {
        Args: {
          p_address: string
          p_apt_suite?: string
          p_city?: string
          p_client_user_id: string
          p_is_primary?: boolean
          p_latitude?: number
          p_longitude?: number
          p_name: string
          p_state?: string
          p_zip_code?: string
        }
        Returns: string
      }
      ai_daily_limit_for_tier: { Args: { _tier: string }; Returns: number }
      billing_monthly_cents: {
        Args: {
          p_billing_interval: string
          p_discount_amount_cents: number
          p_discount_percent: number
          p_interval_count: number
          p_quantity: number
          p_unit_amount_cents: number
        }
        Returns: number
      }
      billing_payer_plan_types: {
        Args: { p_org_ids: string[] }
        Returns: {
          organization_id: string
          plan_type: string
        }[]
      }
      broadcast_audience: {
        Args: { p_message_class: string }
        Returns: {
          eligible: boolean
          email: string
          organization_id: string
          skip_reason: string
          user_id: string
        }[]
      }
      campaign_queue_dispatch: { Args: never; Returns: undefined }
      change_client_portal_password: {
        Args: {
          p_current_password: string
          p_new_password: string
          p_user_id: string
        }
        Returns: Json
      }
      check_and_increment_ai_rate_limit: {
        Args: {
          p_limit: number
          p_scope: string
          p_scope_id: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          current_count: number
          limit_value: number
          retry_after_seconds: number
        }[]
      }
      classify_service_bucket: { Args: { p_name: string }; Returns: string }
      cleanup_ai_rate_limits: { Args: never; Returns: number }
      client_cancel_booking: {
        Args: { p_booking_id: string; p_customer_id: string }
        Returns: Json
      }
      compute_org_benchmark_metrics: {
        Args: { p_org_id: string; p_period_start: string }
        Returns: {
          avg_price: number
          avg_rating: number
          bookings_count: number
          cancel_rate: number
          noshow_rate: number
          recurring_share: number
          repeat_rate: number
          review_rate: number
          service_bucket: string
        }[]
      }
      consume_ai_credit: {
        Args: { _org_id: string }
        Returns: {
          allowed: boolean
          daily_limit: number
          purchased_balance: number
          resets_at: string
          source: string
          used_today: number
        }[]
      }
      create_booking_from_request: {
        Args: {
          p_customer_id: string
          p_duration?: number
          p_organization_id: string
          p_request_id: string
          p_scheduled_at: string
          p_service_id: string
        }
        Returns: string
      }
      create_client_portal_referral: {
        Args: {
          p_portal_user_id: string
          p_referred_email: string
          p_referred_name?: string
        }
        Returns: Json
      }
      create_client_portal_user: {
        Args: {
          p_customer_id: string
          p_must_change_password?: boolean
          p_organization_id: string
          p_password: string
          p_username: string
        }
        Returns: string
      }
      credit_ai_purchase: {
        Args: {
          _amount: number
          _org_id: string
          _reason?: string
          _stripe_session_id: string
        }
        Returns: {
          already_processed: boolean
          new_balance: number
        }[]
      }
      current_user_may_create_organization: { Args: never; Returns: boolean }
      delete_client_booking_request: {
        Args: { p_client_user_id: string; p_request_id: string }
        Returns: boolean
      }
      delete_client_portal_location: {
        Args: { p_client_user_id: string; p_location_id: string }
        Returns: boolean
      }
      delete_client_portal_notification: {
        Args: { p_client_user_id: string; p_notification_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      effective_plan: { Args: { _org_id: string }; Returns: string }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_ai_credit_status: {
        Args: { _org_id: string }
        Returns: {
          daily_limit: number
          plan_tier: string
          purchased_balance: number
          resets_at: string
          used_today: number
        }[]
      }
      get_client_portal_bookings: {
        Args: { p_customer_id: string }
        Returns: {
          address: string
          booking_number: number
          id: string
          scheduled_at: string
          service_name: string
          status: string
          total_amount: number
        }[]
      }
      get_client_portal_locations: {
        Args: { p_customer_id: string }
        Returns: {
          address: string
          apt_suite: string
          city: string
          id: string
          is_primary: boolean
          name: string
          state: string
          zip_code: string
        }[]
      }
      get_client_portal_notifications: {
        Args: { p_client_user_id: string }
        Returns: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
        }[]
      }
      get_client_portal_requests: {
        Args: { p_client_user_id: string }
        Returns: {
          admin_response_note: string
          created_at: string
          id: string
          notes: string
          requested_date: string
          service_name: string
          status: string
        }[]
      }
      get_client_portal_user_data: {
        Args: { p_email: string }
        Returns: {
          customer_id: string
          email: string
          first_name: string
          is_active: boolean
          last_name: string
          loyalty_lifetime_points: number
          loyalty_points: number
          loyalty_tier: string
          must_change_password: boolean
          organization_id: string
          phone: string
          property_type: string
          user_id: string
          username: string
        }[]
      }
      get_client_tax_report: {
        Args: { p_client_user_id: string; p_year?: number }
        Returns: {
          address: string
          booking_date: string
          payment_status: string
          service_name: string
          subtotal: number
          tax_amount: number
          total_amount: number
        }[]
      }
      get_demo_availability: { Args: never; Returns: Json }
      get_demo_booked_slots: {
        Args: never
        Returns: {
          booked_date: string
          booked_time: string
        }[]
      }
      get_deposit_by_token: {
        Args: { p_token: string }
        Returns: {
          amount: number
          booking_id: string
          customer_name: string
          id: string
          organization_id: string
          status: string
          token: string
        }[]
      }
      get_lifetime_spots_remaining: {
        Args: never
        Returns: {
          remaining: number
          sold: number
          sold_out: boolean
          total: number
        }[]
      }
      get_loyalty_tier_info: {
        Args: { p_organization_id: string }
        Returns: {
          benefits: Json
          color: string
          max_spending: number
          min_spending: number
          tier_name: string
          tier_order: number
        }[]
      }
      get_my_staff_profile: {
        Args: { p_organization_id?: string }
        Returns: {
          avatar_url: string
          base_wage: number
          bio: string
          default_hours: number
          email: string
          home_address: string
          home_latitude: number
          home_longitude: number
          hourly_rate: number
          id: string
          name: string
          organization_id: string
          percentage_rate: number
          phone: string
          tax_classification: string
        }[]
      }
      get_my_wage_rates_for_booking: {
        Args: { _booking_id: string }
        Returns: {
          base_wage: number
          hourly_rate: number
          percentage_rate: number
        }[]
      }
      get_org_benchmarks: {
        Args: { p_cohort?: string; p_org_id: string }
        Returns: Json
      }
      get_org_email_settings_safe: {
        Args: { _organization_id: string }
        Returns: {
          created_at: string
          email_footer: string
          email_send_method: string
          from_email: string
          from_name: string
          gmail_account_type: string
          id: string
          organization_id: string
          reply_to_email: string
          resend_api_key_configured: boolean
          smtp_email: string
          smtp_password_configured: boolean
          updated_at: string
        }[]
      }
      get_org_ghl_dispatch_config: {
        Args: { _org_id: string }
        Returns: {
          auth_header_name: string
          auth_token: string
          enabled: boolean
          event_config: Json
          webhook_url: string
        }[]
      }
      get_org_ghl_settings_safe: {
        Args: { _organization_id: string }
        Returns: {
          auth_header_name: string
          auth_token_configured: boolean
          created_at: string
          enabled: boolean
          event_config: Json
          id: string
          organization_id: string
          updated_at: string
          webhook_url: string
        }[]
      }
      get_org_member_names: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      get_org_stripe_public_settings: {
        Args: { p_org_id: string }
        Returns: {
          connected_at: string
          is_connected: boolean
          organization_id: string
          stripe_account_id: string
          stripe_default_currency: string
          stripe_display_name: string
          stripe_payouts_enabled: boolean
          stripe_publishable_key: string
          stripe_user_email: string
        }[]
      }
      get_org_stripe_secret: {
        Args: { p_org_id: string }
        Returns: {
          stripe_access_token: string
          stripe_account_id: string
          stripe_secret_key: string
        }[]
      }
      get_org_stripe_settings_safe: {
        Args: { p_organization_id: string }
        Returns: {
          connected_at: string
          created_at: string
          id: string
          is_connected: boolean
          organization_id: string
          stripe_account_id: string
          stripe_default_currency: string
          stripe_display_name: string
          stripe_payouts_enabled: boolean
          stripe_publishable_key: string
          stripe_user_email: string
          updated_at: string
        }[]
      }
      get_org_tiers: {
        Args: { p_organization_id: string }
        Returns: {
          benefits: Json
          color: string
          max_spending: number
          min_spending: number
          tier_name: string
          tier_order: number
        }[]
      }
      get_public_booking_settings: { Args: { p_org_id: string }; Returns: Json }
      get_review_request_by_token: {
        Args: { p_token: string }
        Returns: {
          booking_id: string
          customer_id: string
          google_review_url: string
          id: string
          rating: number
          responded_at: string
          review_text: string
          staff_id: string
          status: string
        }[]
      }
      get_staff_sensitive_fields: {
        Args: { _staff_id: string }
        Returns: {
          ein: string
          ssn_last4: string
        }[]
      }
      get_tip_by_token: {
        Args: { p_token: string }
        Returns: {
          amount: number
          booking_id: string
          customer_name: string
          id: string
          organization_id: string
          status: string
          token: string
        }[]
      }
      get_user_organization_id: { Args: never; Returns: string }
      has_active_subscription: { Args: { _org_id: string }; Returns: boolean }
      has_openphone_api_key: { Args: { _org_id: string }; Returns: boolean }
      has_org_financial_access: { Args: { _org_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_stripe_secret_key: {
        Args: { _organization_id: string }
        Returns: boolean
      }
      hash_client_portal_password: {
        Args: { p_password: string }
        Returns: string
      }
      increment_campaign_run_counter: {
        Args: {
          p_amount?: number
          p_counter: string
          p_next_send_at?: string
          p_run_id: string
        }
        Returns: undefined
      }
      increment_coupon_use: {
        Args: { p_discount_id: string }
        Returns: boolean
      }
      increment_org_email_daily_send: {
        Args: { _delta?: number; _method?: string; _organization_id: string }
        Returns: number
      }
      is_client_portal_user: {
        Args: { _client_user_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_admin:
        | { Args: { _org_id: string }; Returns: boolean }
        | { Args: { _org_id: string; _user_id: string }; Returns: boolean }
      is_org_member:
        | { Args: { _org_id: string }; Returns: boolean }
        | { Args: { _org_id: string; _user_id: string }; Returns: boolean }
      is_org_operator: { Args: { _org_id: string }; Returns: boolean }
      is_org_owner: { Args: { _org_id: string }; Returns: boolean }
      is_org_staff: { Args: { _org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_platform_blog_admin: { Args: never; Returns: boolean }
      list_org_members: {
        Args: { _organization_id: string }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          role: string
          user_id: string
        }[]
      }
      log_benchmark_event: {
        Args: {
          p_duration_ms: number
          p_error_code?: string
          p_event_type: string
          p_metadata: Json
          p_organization_id: string
          p_status: string
        }
        Returns: string
      }
      log_org_email_send_failure: {
        Args: {
          _error_message: string
          _fell_back_to: string
          _method: string
          _organization_id: string
          _recipient: string
          _subject: string
        }
        Returns: undefined
      }
      mark_client_notification_read: {
        Args: { p_client_user_id: string; p_notification_id: string }
        Returns: boolean
      }
      merge_customers: {
        Args: { primary_id: string; secondary_id: string }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_effective_plan: {
        Args: never
        Returns: {
          organization_id: string
          plan_type: string
          raw_plan_type: string
        }[]
      }
      org_has_no_memberships: { Args: { _org_id: string }; Returns: boolean }
      org_has_resend_api_key: { Args: { p_org_id: string }; Returns: boolean }
      org_stripe_has_secrets: {
        Args: { _org_id: string }
        Returns: {
          has_access_token: boolean
          has_refresh_token: boolean
          has_secret_key: boolean
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      redeem_access_code: { Args: { _code: string }; Returns: Json }
      refresh_peer_benchmark_snapshots: { Args: never; Returns: number }
      remove_org_member: {
        Args: { _organization_id: string; _target_user_id: string }
        Returns: undefined
      }
      reset_client_portal_password: {
        Args: { p_new_password: string; p_user_id: string }
        Returns: boolean
      }
      reset_daily_tasks: { Args: never; Returns: undefined }
      resolve_customer_tier: {
        Args: { p_customer_id: string }
        Returns: string
      }
      resolve_short_url: {
        Args: { p_code: string }
        Returns: {
          expires_at: string
          target_url: string
        }[]
      }
      send_to_dlq: {
        Args: { dlq_name: string; payload: Json }
        Returns: number
      }
      set_campaign_run_status: {
        Args: { p_run_id: string; p_status: string }
        Returns: {
          campaign_id: string
          cancel_reason: string | null
          completed_at: string | null
          created_at: string
          expires_at: string
          failed_count: number
          id: string
          next_send_at: string | null
          organization_id: string
          paused_at: string | null
          scheduled_at: string | null
          sent_count: number
          skipped_opted_out_count: number
          started_at: string | null
          status: string
          throttle_seconds: number
          total_recipients: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_message_vt: {
        Args: { message_id: number; queue_name: string; vt_seconds?: number }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_can_view_booking: {
        Args: { _booking_id: string; _org_id: string }
        Returns: boolean
      }
      staff_can_view_booking_v2: {
        Args: { _booking_id: string; _org_id: string; _staff_id: string }
        Returns: boolean
      }
      staff_can_view_customer: {
        Args: { _customer_id: string; _org_id: string }
        Returns: boolean
      }
      staff_owns_assignment: { Args: { _staff_id: string }; Returns: boolean }
      stripe_duplicate_accounts: {
        Args: never
        Returns: {
          org_count: number
          organization_ids: string[]
          stripe_account_id: string
        }[]
      }
      submit_client_booking_request: {
        Args: {
          p_client_user_id: string
          p_customer_id: string
          p_location_id?: string
          p_notes?: string
          p_organization_id: string
          p_requested_date: string
          p_service_id?: string
        }
        Returns: string
      }
      submit_review_by_token: {
        Args: { p_rating: number; p_review_text?: string; p_token: string }
        Returns: boolean
      }
      unmerge_customers: {
        Args: { primary_id: string; secondary_id: string; snapshot: Json }
        Returns: Json
      }
      update_client_portal_last_login: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      update_client_portal_location: {
        Args: {
          p_address?: string
          p_apt_suite?: string
          p_city?: string
          p_client_user_id: string
          p_customer_id: string
          p_latitude?: number
          p_location_id: string
          p_longitude?: number
          p_name?: string
          p_state?: string
          p_zip_code?: string
        }
        Returns: boolean
      }
      update_client_portal_profile: {
        Args: {
          p_client_user_id: string
          p_first_name: string
          p_last_name: string
          p_phone?: string
        }
        Returns: boolean
      }
      update_org_member_role: {
        Args: {
          _new_role: string
          _organization_id: string
          _target_user_id: string
        }
        Returns: undefined
      }
      validate_client_portal_login: {
        Args: { p_email: string; p_password: string }
        Returns: Json
      }
      verify_external_booking_secret: {
        Args: { _org_id: string; _secret: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "user"
      booking_status:
        | "pending"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
        | "rescheduled"
      payment_status: "pending" | "partial" | "paid" | "refunded"
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
      app_role: ["admin", "staff", "user"],
      booking_status: [
        "pending",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ],
      payment_status: ["pending", "partial", "paid", "refunded"],
    },
  },
} as const
