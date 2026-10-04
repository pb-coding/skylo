const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:3001",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

export default allowedOrigins;
