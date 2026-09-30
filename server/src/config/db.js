import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set in the environment");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    // Sensible defaults for a small-scale multi-tenant SaaS on a shared cluster
    maxPoolSize: 20,
  });

  console.log(`[db] connected to MongoDB: ${mongoose.connection.name}`);

  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });
}
