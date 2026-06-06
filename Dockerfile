# --- STAGE 1: Build & Dependencies ---
FROM node:20-alpine AS builder

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy dependency files first to exploit Docker's layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build scripts)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Optional: Run a build step if you use TypeScript, Next.js, etc.
# RUN npm run build

# Remove development dependencies to keep the final image light
RUN npm prune --production


# --- STAGE 2: Final Runtime ---
FROM node:20-alpine

# Set environment variable to production
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy only the necessary runtime files from the builder stage
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/src ./src

# Use the built-in non-root 'node' user for security compliance
USER node

# Document the port the application listens on
EXPOSE 3000

# Define the command to execute your application
CMD [ "node", "src/index.js" ]
