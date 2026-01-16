/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // ✅ กัน useEffect ยิงซ้ำใน dev (ทำให้โจทย์ไม่เด้งเอง)

  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: [
    "http://localhost:3000",
    "http://26.175.242.170:3000",
  ],
};

module.exports = nextConfig;
