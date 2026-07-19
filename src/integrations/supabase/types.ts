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
      call_events: {
        Row: {
          dealer_id: string | null
          id: string
          job_id: string
          message: string | null
          stage: string
          status: string
          ts: string
        }
        Insert: {
          dealer_id?: string | null
          id?: string
          job_id: string
          message?: string | null
          stage: string
          status?: string
          ts?: string
        }
        Update: {
          dealer_id?: string | null
          id?: string
          job_id?: string
          message?: string | null
          stage?: string
          status?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      dealers: {
        Row: {
          created_at: string
          dealer_id: string
          dealer_name: string
          id: string
          job_id: string
          style: string | null
        }
        Insert: {
          created_at?: string
          dealer_id: string
          dealer_name: string
          id?: string
          job_id: string
          style?: string | null
        }
        Update: {
          created_at?: string
          dealer_id?: string
          dealer_name?: string
          id?: string
          job_id?: string
          style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          id: string
          job_spec: Json
          report: Json | null
          stage: string
          updated_at: string
          vertical: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_spec?: Json
          report?: Json | null
          stage?: string
          updated_at?: string
          vertical: string
        }
        Update: {
          created_at?: string
          id?: string
          job_spec?: Json
          report?: Json | null
          stage?: string
          updated_at?: string
          vertical?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          add_ons_declined: Json
          apr: number | null
          bottom_line: number | null
          conversation_id: string | null
          created_at: string
          dealer_id: string
          dealer_name: string
          fees: Json
          id: string
          job_id: string
          line_items: Json
          out_the_door: number | null
          outcome: string
          quote_source_turns: Json | null
          round: number
          trade_in_offer: number | null
          transcript: string | null
          vehicle_price: number | null
        }
        Insert: {
          add_ons_declined?: Json
          apr?: number | null
          bottom_line?: number | null
          conversation_id?: string | null
          created_at?: string
          dealer_id: string
          dealer_name: string
          fees?: Json
          id?: string
          job_id: string
          line_items?: Json
          out_the_door?: number | null
          outcome?: string
          quote_source_turns?: Json | null
          round?: number
          trade_in_offer?: number | null
          transcript?: string | null
          vehicle_price?: number | null
        }
        Update: {
          add_ons_declined?: Json
          apr?: number | null
          bottom_line?: number | null
          conversation_id?: string | null
          created_at?: string
          dealer_id?: string
          dealer_name?: string
          fees?: Json
          id?: string
          job_id?: string
          line_items?: Json
          out_the_door?: number | null
          outcome?: string
          quote_source_turns?: Json | null
          round?: number
          trade_in_offer?: number | null
          transcript?: string | null
          vehicle_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
          vertical: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
          vertical: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
          vertical?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
