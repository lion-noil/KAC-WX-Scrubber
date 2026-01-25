
winget install -e --id Gyan.FFmpeg

cd .\radar-replay\src\assets\before_media\  

npm run dev

 ffmpeg -i 20250719.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -an 20250719_h264.mp4
