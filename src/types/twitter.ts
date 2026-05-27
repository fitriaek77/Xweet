// src/types/twitter.ts
// Twitter API response types.

export interface TwitterUser {
  id: string;
  name: string;
  screen_name: string;
  profile_image_url_https: string;
}

export interface TwitterCreateTweetResponse {
  data: {
    create_tweet: {
      tweet_results: {
        result: {
          rest_id: string;
          core: { user_results: { result: { legacy: TwitterUser } } };
          legacy: { full_text: string; created_at: string };
        };
      };
    };
  };
}

export interface TwitterScheduledTweetResponse {
  data: {
    create_scheduled_tweet: {
      scheduled_tweet: {
        rest_id: string;
      };
    };
  };
}

export interface TwitterScheduledTweetItem {
  rest_id: string;
  core: { user_results: { result: { legacy: TwitterUser } } };
  scheduled_tweet: {
    execute_at: number;
    status: string;
    tweet: {
      rest_id: string;
      legacy: { full_text: string };
    };
  };
}

export interface TwitterFetchScheduledResponse {
  data: {
    viewer: {
      scheduled_tweet_list: TwitterScheduledTweetItem[];
    };
  };
}

export interface TwitterMediaUploadInitResponse {
  media_id: number;
  media_id_string: string;
  expires_after_secs: number;
}

export interface TwitterMediaUploadAppendResponse {
  media_id: number;
  media_id_string: string;
  segment_index: number;
}

export interface TwitterMediaUploadFinalizeResponse {
  media_id: number;
  media_id_string: string;
  size: number;
  expires_after_secs: number;
  processing_info?: {
    state: "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    error?: { code: number; message: string };
  };
}

export interface TwitterMediaUploadStatusResponse {
  media_id: number;
  media_id_string: string;
  processing_info: {
    state: "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    error?: { code: number; message: string };
  };
}

export interface TwitterError {
  code: number;
  message: string;
}

export interface TwitterErrorResponse {
  errors: TwitterError[];
}
