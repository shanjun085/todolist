@echo off
setlocal
REM Bundle the Windows installer (NSIS). Requires: Rust + MSVC C++ toolset +
REM Node.js. Runs the official Tauri CLI via npx (no global install needed).

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
where npx >nul 2>nul
if errorlevel 1 (
  echo [error] npx not found - install Node.js from https://nodejs.org
  exit /b 1
)

cd /d "%~dp0..\tauri\src-tauri"
echo === npx tauri build --bundles nsis ===
npx --yes @tauri-apps/cli@^2 build --bundles nsis
exit /b %errorlevel%
