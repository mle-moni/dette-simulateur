#!/bin/bash

# Deploy the application on the server

# exit on error
set -e

yarn install

yarn build

sudo rm -rf /var/www/dette
sudo mv dist /var/www/dette
