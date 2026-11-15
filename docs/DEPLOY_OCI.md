# Deploying to Oracle Cloud (OCI)

This guide puts everything on Oracle Cloud: one Ubuntu VM runs the web app and the API behind Nginx,
MySQL runs as a managed MySQL HeatWave database (or on the same VM for a small start), and uploads go to Object Storage.
Check Oracle's current Always Free limits when you choose shapes; they change from time to time.

## 1. Create the resources

1. **Account and compartment.** Sign up at cloud.oracle.com, then create a compartment (e.g. `sms-prod`) to keep everything together.
2. **Network.** Networking → Virtual Cloud Networks → *Start VCN Wizard* → "Create VCN with Internet Connectivity".
   In the public subnet's security list, allow inbound TCP **22, 80, 443**.
3. **VM.** Compute → Instances → Create. Image: Ubuntu 24.04. Shape: Ampere (VM.Standard.A1.Flex), e.g. 2 OCPU / 12 GB to start.
   Put it in the public subnet, add your SSH key, and note the public IP.
4. **Database (pick one):**
   - **MySQL HeatWave (recommended):** Databases → MySQL HeatWave → Create DB system in the *private* subnet of the same VCN.
     Allow TCP 3306 from the VM's subnet in the private subnet's security list. Note the private IP, admin user and password.
     Turn on automatic backups (daily) and point-in-time recovery.
   - **MySQL on the VM:** `sudo apt install mysql-server` on the VM. Cheaper, but you must handle backups yourself.
5. **Object Storage.** Storage → Buckets → Create bucket `sms-files` (Standard tier, **private**, no public access).
   Find your **namespace** on the bucket page.
6. **S3 keys for the bucket.** Profile menu → your user → *Customer secret keys* → Generate. Save the access key and secret.
   The endpoint is `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com` (for example region `me-dubai-1` or `ap-mumbai-1`).

## 2. Prepare the VM

```bash
ssh ubuntu@<public-ip>
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx git mysql-client
sudo npm install -g pm2
# Ubuntu images on OCI also block ports with iptables:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Database

```sql
-- connect: mysql -h <db-private-ip> -u admin -p
CREATE DATABASE sms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sms'@'%' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON sms.* TO 'sms'@'%';
```

## 4. App

```bash
git clone <your-repo-url> /opt/sms && cd /opt/sms
npm ci
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Set in `apps/api/.env`:

```
NODE_ENV=production
DATABASE_URL="mysql://sms:<password>@<db-private-ip>:3306/sms"
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
APP_URL=https://your-domain.com
COOKIE_SECURE=true
STORAGE_DRIVER=oci
OCI_S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
OCI_REGION=<region>
OCI_BUCKET=sms-files
OCI_ACCESS_KEY_ID=<customer secret key id>
OCI_SECRET_ACCESS_KEY=<customer secret key>
WHATSAPP_GRAPH_VERSION=v23.0   # check Meta's current Graph API version
WHATSAPP_DRY_RUN=false
PAYMENTS_TEST_GATEWAY=false   # never true in production
SUPER_ADMIN_USERNAME=<you>
SUPER_ADMIN_PASSWORD=<strong password>
```

Keep `ENCRYPTION_KEY` safe and never change it after schools save secrets: encrypted values cannot be read without it.

```bash
npm run db:deploy -w apps/api
npm run create-super-admin -w apps/api
npm run build
pm2 start npm --name sms-api -- run start -w apps/api
API_URL=http://127.0.0.1:4000 pm2 start npm --name sms-web -- run start -w apps/web
pm2 save && pm2 startup     # run the command it prints
```

## 5. Nginx and HTTPS

Point your domain's A record to the VM's public IP, then create `/etc/nginx/sites-available/sms`:

```nginx
server {
  server_name your-domain.com;
  client_max_body_size 60m;            # at least your largest plan's max file size

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;     # needed later for live chat
    proxy_set_header Connection "upgrade";
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sms /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain.com
```

## 6. Updating

```bash
cd /opt/sms && git pull && npm ci && npm run db:deploy -w apps/api && npm run build && pm2 restart all
```

## 7. Backups

- MySQL HeatWave: automatic daily backups + point-in-time recovery (set retention to at least 14 days).
- Object Storage: enable versioning on the bucket so deleted or overwritten files can be recovered.
