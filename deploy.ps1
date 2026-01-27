$ServerIP = "192.168.1.70"
$User = "vcloud"
$Password = "Vcloud123."
$RemotePath = "~/app"

Write-Host "Dağıtım başlıyor... Sunucu: $ServerIP" -ForegroundColor Green

# 1. Dosyaları Sunucuya Kopyala (SCP)
Write-Host "Dosyalar kopyalanıyor..." -ForegroundColor Cyan
scp -o StrictHostKeyChecking=no -r ./app ./prisma ./public ./package.json ./package-lock.json ./Dockerfile ./docker-compose.yml ./setup_vps.sh ./vite.config.ts ./tsconfig.json ./.npmrc ${User}@${ServerIP}:${RemotePath}/

if ($LASTEXITCODE -ne 0) {
    Write-Host "Dosya kopyalama hatası! Lütfen şifreyi doğru girdiğinizden ve sunucunun erişilebilir olduğundan emin olun." -ForegroundColor Red
    exit
}

# 2. Kurulum ve Başlatma (SSH)
Write-Host "Sunucu üzerinde kurulum yapılıyor..." -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no -t ${User}@${ServerIP} "chmod +x ${RemotePath}/setup_vps.sh && ${RemotePath}/setup_vps.sh && cd ${RemotePath} && sudo docker compose up -d --build"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Kurulum sırasında hata oluştu!" -ForegroundColor Red
} else {
    Write-Host "Dağıtım başarıyla tamamlandı!" -ForegroundColor Green
    Write-Host "Uygulamaya şu adresten erişebilirsiniz: http://${ServerIP}:3000" -ForegroundColor Yellow
}
