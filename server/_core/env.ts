export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  port: parseInt(process.env.PORT ?? "3000", 10),
  isProduction: process.env.NODE_ENV === "production",
};
