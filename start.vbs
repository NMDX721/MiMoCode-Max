Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\NMDX\mimocode-max-tauri"
WshShell.Run "cmd /c node server.js", 0, False
WshShell.Run "cmd /c npx tauri dev", 0, False
