param([string]$Compiler = 'gcc', [switch]$Debug)
$ErrorActionPreference = 'Stop'
$outputDirectory = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$watermarkSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'watermark.lua'), [Text.Encoding]::UTF8)
$watermarkWords = foreach ($character in $watermarkSource.ToCharArray()) { '0x{0:x4}' -f [int]$character }
$watermarkHeader = 'static const uint16_t watermark_script[] = {' + ($watermarkWords -join ',') + ',0};'
[IO.File]::WriteAllText((Join-Path $outputDirectory 'watermark_script.h'), $watermarkHeader, [Text.Encoding]::ASCII)
$compilerArgs = @('-std=c11', '-Wall', '-Wextra', '-Werror', '-municode', '-mwindows', '-static-libgcc',
    (Join-Path $PSScriptRoot 'shell.c'), '-o', (Join-Path $outputDirectory 'AzurPromilia.exe'),
    '-lbcrypt', '-lshell32', '-luser32')
if ($Debug) { $compilerArgs += @('-O0', '-g') } else { $compilerArgs += @('-O2', '-s') }
& $Compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "C compiler failed with exit code $LASTEXITCODE" }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cbt3-shell.ini') -Destination $outputDirectory
Write-Output (Join-Path $outputDirectory 'AzurPromilia.exe')
