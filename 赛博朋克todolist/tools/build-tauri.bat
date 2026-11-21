@echo off
setlocal
REM Build the Tauri desktop app. Requires: Rust (rustup.rs) + Visual Studio
REM Build Tools with the C++ workload. Portable: locates VS via vswhere and
REM uses this script's own location, so it works from any checkout.

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo [error] vswhere.exe not found - install "Visual Studio 2022 Build Tools"
  echo         with the "Desktop development with C++" workload first.
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR (
  echo [error] no Visual Studio installation with the MSVC x64 toolset found.
  exit /b 1
)
call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [error] vcvars64.bat failed
  exit /b 1
)

if exist "%USERPROFILE%\.cargo\bin" set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
where cargo >nul 2>nul
if errorlevel 1 (
  echo [error] cargo not found - install Rust from https://rustup.rs
  exit /b 1
)

cd /d "%~dp0..\tauri\src-tauri"
echo === cargo build --release ===
cargo build --release
exit /b %errorlevel%
