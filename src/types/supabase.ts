/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any schema change:
 *   npx supabase gen types typescript --project-id itdjhxhyuhdyvpcbtokn > src/types/supabase.ts
 *
 * This is the contract between the Postgres schema and the sync layer. Editing
 * it by hand would let the two drift silently, which is exactly the class of
 * bug the generated types exist to prevent.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.17';
  };
  public: {
    Tables: {
      associations: {
        Row: {
          count: number;
          entity_id: string;
          last_observed_at: string;
          other_entity_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          count?: number;
          entity_id: string;
          last_observed_at: string;
          other_entity_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          count?: number;
          entity_id?: string;
          last_observed_at?: string;
          other_entity_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      attributes: {
        Row: {
          confidence: number;
          entity_id: string;
          id: string;
          key: string;
          observed_at: string;
          sighting_id: string | null;
          source: Database['public']['Enums']['attribute_source'];
          updated_at: string;
          user_id: string;
          value: string;
        };
        Insert: {
          confidence: number;
          entity_id: string;
          id?: string;
          key: string;
          observed_at: string;
          sighting_id?: string | null;
          source?: Database['public']['Enums']['attribute_source'];
          updated_at?: string;
          user_id: string;
          value: string;
        };
        Update: {
          confidence?: number;
          entity_id?: string;
          id?: string;
          key?: string;
          observed_at?: string;
          sighting_id?: string | null;
          source?: Database['public']['Enums']['attribute_source'];
          updated_at?: string;
          user_id?: string;
          value?: string;
        };
        Relationships: [];
      };
      entities: {
        Row: {
          archived_at: string | null;
          class: string;
          created_at: string;
          favorite: boolean;
          first_seen_at: string;
          id: string;
          kind: Database['public']['Enums']['entity_kind'];
          label: string;
          last_seen_at: string;
          merged_from_ids: string[];
          profile: Json;
          sighting_count: number;
          summary: string | null;
          thumbnail_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          class: string;
          created_at?: string;
          favorite?: boolean;
          first_seen_at: string;
          id?: string;
          kind: Database['public']['Enums']['entity_kind'];
          label: string;
          last_seen_at: string;
          merged_from_ids?: string[];
          profile?: Json;
          sighting_count?: number;
          summary?: string | null;
          thumbnail_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          class?: string;
          created_at?: string;
          favorite?: boolean;
          first_seen_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['entity_kind'];
          label?: string;
          last_seen_at?: string;
          merged_from_ids?: string[];
          profile?: Json;
          sighting_count?: number;
          summary?: string | null;
          thumbnail_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      entity_ordinals: {
        Row: {
          kind: Database['public']['Enums']['entity_kind'];
          updated_at: string;
          user_id: string;
          value: number;
        };
        Insert: {
          kind: Database['public']['Enums']['entity_kind'];
          updated_at?: string;
          user_id: string;
          value?: number;
        };
        Update: {
          kind?: Database['public']['Enums']['entity_kind'];
          updated_at?: string;
          user_id?: string;
          value?: number;
        };
        Relationships: [];
      };
      face_embeddings: {
        Row: {
          created_at: string;
          descriptor: string;
          dimensions: number;
          entity_id: string;
          id: string;
          model: string;
          score: number;
          sighting_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          descriptor: string;
          dimensions: number;
          entity_id: string;
          id?: string;
          model: string;
          score: number;
          sighting_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          descriptor?: string;
          dimensions?: number;
          entity_id?: string;
          id?: string;
          model?: string;
          score?: number;
          sighting_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      media: {
        Row: {
          byte_size: number;
          created_at: string;
          entity_id: string | null;
          height: number;
          id: string;
          kind: Database['public']['Enums']['media_kind'];
          mime_type: string;
          session_id: string | null;
          sighting_id: string | null;
          storage_path: string;
          updated_at: string;
          user_id: string;
          width: number;
        };
        Insert: {
          byte_size: number;
          created_at?: string;
          entity_id?: string | null;
          height: number;
          id?: string;
          kind: Database['public']['Enums']['media_kind'];
          mime_type: string;
          session_id?: string | null;
          sighting_id?: string | null;
          storage_path: string;
          updated_at?: string;
          user_id: string;
          width: number;
        };
        Update: {
          byte_size?: number;
          created_at?: string;
          entity_id?: string | null;
          height?: number;
          id?: string;
          kind?: Database['public']['Enums']['media_kind'];
          mime_type?: string;
          session_id?: string | null;
          sighting_id?: string | null;
          storage_path?: string;
          updated_at?: string;
          user_id?: string;
          width?: number;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          author: string;
          body: string;
          created_at: string;
          entity_id: string;
          id: string;
          sighting_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          author: string;
          body: string;
          created_at?: string;
          entity_id: string;
          id?: string;
          sighting_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          author?: string;
          body?: string;
          created_at?: string;
          entity_id?: string;
          id?: string;
          sighting_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          accuracy_m: number | null;
          counts: Json;
          created_at: string;
          detector_id: string;
          device_label: string | null;
          ended_at: string | null;
          facing_mode: string | null;
          id: string;
          latitude: number | null;
          longitude: number | null;
          started_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accuracy_m?: number | null;
          counts?: Json;
          created_at?: string;
          detector_id: string;
          device_label?: string | null;
          ended_at?: string | null;
          facing_mode?: string | null;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          started_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          counts?: Json;
          created_at?: string;
          detector_id?: string;
          device_label?: string | null;
          ended_at?: string | null;
          facing_mode?: string | null;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          started_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sightings: {
        Row: {
          accuracy_m: number | null;
          box: Json;
          class: string;
          confidence: number;
          created_at: string;
          direction: Database['public']['Enums']['camera_direction'];
          duration_ms: number;
          ended_at: string;
          entity_id: string;
          id: string;
          kind: Database['public']['Enums']['entity_kind'];
          latitude: number | null;
          longitude: number | null;
          observation_id: string;
          session_id: string;
          started_at: string;
          thumbnail_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accuracy_m?: number | null;
          box: Json;
          class: string;
          confidence: number;
          created_at?: string;
          direction?: Database['public']['Enums']['camera_direction'];
          duration_ms: number;
          ended_at: string;
          entity_id: string;
          id?: string;
          kind: Database['public']['Enums']['entity_kind'];
          latitude?: number | null;
          longitude?: number | null;
          observation_id: string;
          session_id: string;
          started_at: string;
          thumbnail_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          box?: Json;
          class?: string;
          confidence?: number;
          created_at?: string;
          direction?: Database['public']['Enums']['camera_direction'];
          duration_ms?: number;
          ended_at?: string;
          entity_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['entity_kind'];
          latitude?: number | null;
          longitude?: number | null;
          observation_id?: string;
          session_id?: string;
          started_at?: string;
          thumbnail_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      next_entity_ordinal: {
        Args: { p_kind: Database['public']['Enums']['entity_kind'] };
        Returns: number;
      };
    };
    Enums: {
      attribute_source: 'model' | 'user';
      camera_direction: 'left' | 'right' | 'up' | 'down' | 'toward' | 'away' | 'static';
      entity_kind: 'person' | 'vehicle' | 'animal' | 'object';
      media_kind: 'thumbnail' | 'snapshot' | 'clip';
    };
    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
