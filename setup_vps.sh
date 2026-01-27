#!/bin/bash

# Update package index
apt-get update

# Install prerequisites
apt-get install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io

# Install Docker Compose (plugin)
apt-get install -y docker-compose-plugin

# Create app directory (should be run as user, but we are root now... permissions might be an issue if we want user to own it)
# We can skip mkdir as we already copied files to ~/app (user home).
# Ensure permissions
chown -R vcloud:vcloud /home/vcloud/app

echo "VPS setup complete. Docker installed."
