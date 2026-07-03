export interface AppConfig {
  port: number;
  environment: string;
  cors: {
    origins: string[];
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  ai: {
    providers: Array<{
      name: string;
      apiKey: string;
      baseUrl: string;
      models: string[];
    }>;
  };
}
