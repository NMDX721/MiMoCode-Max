Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\NMDX\mimocode-max-tauri"

' Start dev server in background
WshShell.Run "cmd /c node server.js", 0, False

' Start Tauri with Rust in PATH
WshShell.Run "cmd /c set PATH=%PATH%;C:\Users\Oe_Lee\.cargo\bin && npx tauri dev", 0, False
