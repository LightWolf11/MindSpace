"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const dotenv = require("dotenv");

function loadEnvironment(envFilePath, environment) {
  const filePath = envFilePath || path.join(__dirname, ".env");
  const env = environment || process.env;
  let fileContents = "";

  if (fs.existsSync(filePath)) {
    fileContents = fs.readFileSync(filePath, "utf8");
    const fileEnvironment = dotenv.parse(fileContents);
    Object.keys(fileEnvironment).forEach((key) => {
      if (env[key] === undefined) env[key] = fileEnvironment[key];
    });
  }

  if (!env.JWT_SECRET) {
    if (env.JWT_SECRET !== undefined) {
      throw new Error("JWT_SECRET is empty. Remove the empty value or set a secret of at least 32 characters.");
    }
    const secret = randomBytes(48).toString("base64url");
    const separator = fileContents && !fileContents.endsWith("\n") ? "\n" : "";

    try {
      fs.appendFileSync(filePath, `${separator}JWT_SECRET=${secret}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    } catch (error) {
      throw new Error(`JWT_SECRET is not configured and could not be saved to ${filePath}. Check file permissions.`, {
        cause: error
      });
    }

    env.JWT_SECRET = secret;
    console.warn("Generated a JWT_SECRET and saved it to .env. Keep this file private.");
  }

  if (env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  }

  return env;
}

module.exports = { loadEnvironment };
