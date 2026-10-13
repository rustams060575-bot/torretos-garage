@echo off
rem Concat 1.mp4 then 2.mp4 and dump all frames to frames\frame_0001.jpg ...
cd /d "%~dp0"

set FIRST=1.mp4
set SECOND=2.mp4

for /f %%a in ('ffprobe -v error -select_streams v:0 -show_entries "stream=width" -of "default=nw=1:nk=1" "%FIRST%"') do set W=%%a
for /f %%a in ('ffprobe -v error -select_streams v:0 -show_entries "stream=height" -of "default=nw=1:nk=1" "%FIRST%"') do set H=%%a
for /f %%a in ('ffprobe -v error -select_streams v:0 -show_entries "stream=r_frame_rate" -of "default=nw=1:nk=1" "%FIRST%"') do set FPS=%%a

if not exist frames mkdir frames

ffmpeg -y -i "%FIRST%" -i "%SECOND%" -filter_complex "[0:v]scale=%W%:%H%,setsar=1,fps=%FPS%[a];[1:v]scale=%W%:%H%,setsar=1,fps=%FPS%[b];[a][b]concat=n=2:v=1:a=0[v]" -map "[v]" -q:v 2 -start_number 1 "frames\frame_%%04d.jpg"

echo Done: frames are in the frames folder
