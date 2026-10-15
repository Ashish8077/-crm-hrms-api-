import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().uri().required(),
  CORS_ORIGIN: Joi.string().uri().required(),
  SUPER_ADMIN_EMAIL: Joi.string().email().required(),
  SUPER_ADMIN_PASSWORD: Joi.string().min(8).required(),
  REDIS_URL: Joi.string().uri().required(),
  REDIS_KEY_HMAC_SECRET: Joi.string().min(32).required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TOKEN_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_TOKEN_EXPIRES_IN: Joi.string().default('7d'),
  COOKIE_DOMAIN: Joi.string().optional().allow(''),
  COOKIE_SECURE: Joi.boolean().default(true),
  TRUST_PROXY: Joi.number().default(0),
  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_BUCKET_NAME: Joi.string().required(),
});
