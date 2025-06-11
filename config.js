const config = {
  challenge: false, // Set to true if you want to enable password protection.
  users: {
    // You can add multiple users by doing username: 'password'.
    interstellar: "password",
  },
  geminiApiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE",
};

export default config;
