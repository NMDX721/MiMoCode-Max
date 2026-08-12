Set WshShell = CreateObject("WScript.Shell")

' Check if app is already running
Set objExec = WshShell.Exec("cmd /c tasklist /FI ""IMAGENAME eq mimocode-max-tauri.exe"" /NH")
strOutput = objExec.StdOut.ReadAll()

If InStr(strOutput, "mimocode-max-tauri.exe") > 0 Then
    MsgBox "MiMo Code - Max 已经在运行中", vbInformation, "提示"
    WScript.Quit
End If

' Kill orphaned processes
WshShell.Run "cmd /c taskkill /F /IM node.exe /FI ""WINDOWTITLE eq server.js*"" 2>nul", 0, True

' Start
WshShell.CurrentDirectory = "E:\NMDX\mimocode-max-tauri"
WshShell.Run "cmd /c node server.js", 0, False
WshShell.Run "cmd /c set PATH=%PATH%;C:\Users\Oe_Lee\.cargo\bin && npx tauri dev", 0, False
