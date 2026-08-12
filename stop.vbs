Set WshShell = CreateObject("WScript.Shell")
' Kill all related processes
WshShell.Run "taskkill /F /IM mimocode-max-tauri.exe", 0, True
WshShell.Run "taskkill /F /IM node.exe /FI ""WINDOWTITLE eq server.js*""", 0, True
WshShell.Run "taskkill /F /IM cmd.exe /FI ""WINDOWTITLE eq npx tauri*""", 0, True
MsgBox "MiMo Code - Max 已关闭", vbInformation, "停止"
