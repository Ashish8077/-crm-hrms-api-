export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: process.env.CORS_ORIGIN,
  },

  database: {
    mongodbUri: process.env.MONGODB_URI,
  },
});
