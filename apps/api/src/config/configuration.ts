export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  database: {
    url: process.env.DATABASE_URL,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackUrl: process.env.GITHUB_CALLBACK_URL,
    },
    saml: {
      entryPoint: process.env.SAML_ENTRY_POINT,
      issuer: process.env.SAML_ISSUER,
      cert: process.env.SAML_CERT,
    },
  },

  ai: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      defaultModel: process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-pro',
      timeout: parseInt(process.env.DEEPSEEK_TIMEOUT || '180000', 10),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o',
    },
    claude: {
      apiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
      defaultModel: process.env.CLAUDE_DEFAULT_MODEL || 'claude-sonnet-4',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
      defaultModel: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-pro',
    },
    mistral: {
      apiKey: process.env.MISTRAL_API_KEY,
      defaultModel: process.env.MISTRAL_DEFAULT_MODEL || 'mistral-large-latest',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      defaultModel: process.env.GROQ_DEFAULT_MODEL || 'llama-3.3-70b',
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'llama3.3',
    },
  },

  storage: {
    bucket: process.env.S3_BUCKET || 'autoblog-assets',
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    cdnUrl: process.env.S3_CDN_URL,
  },

  search: {
    host: process.env.MEILI_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILI_MASTER_KEY,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    prices: {
      free: process.env.STRIPE_PRICE_FREE || 'price_free',
      starter: process.env.STRIPE_PRICE_STARTER || 'price_starter_29',
      professional: process.env.STRIPE_PRICE_PROFESSIONAL || 'price_pro_99',
      business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_299',
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_999',
    },
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'sendgrid',
    from: process.env.EMAIL_FROM || 'noreply@autoblog.ai',
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
    },
    mailgun: {
      apiKey: process.env.MAILGUN_API_KEY,
      domain: process.env.MAILGUN_DOMAIN,
    },
    ses: {
      region: process.env.SES_REGION || 'us-east-1',
    },
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },
});
