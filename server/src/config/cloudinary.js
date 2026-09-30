import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a buffer (e.g. from multer memoryStorage) to Cloudinary.
 * Applies automatic compression/format so product photos stay light
 * for a mostly-mobile, sometimes-offline user base.
 */
export function uploadBufferToCloudinary(buffer, { folder, publicId } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder || "hardware-saas/products",
        public_id: publicId,
        resource_type: "image",
        transformation: [
          { width: 1000, height: 1000, crop: "limit" },
          { quality: "auto:good" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

export default cloudinary;
