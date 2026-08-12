Set WshShell = CreateObject("WScript.Shell")
Set WshShellExec = WshShell.Exec("cmd /c tasklist /FI ""IMAGENAME eq mimocode-max-tauri.exe"" /NH")
output = WshShellExec.StdOut.ReadAll()

If InStr(output, "mimocode-max-tauri.exe") > 0 Then
    ' App already running, just show the window
    WshShell.Run "cmd /c powershell -Command ""(Get-Process mimocode-max-tauri).MainWindowHandle | ForEach-Object { [System.Runtime.InteropServices.Marshal]::Release($_) }""", 0, False
    MsgBox "MiMo Code - Max 已经在运行中", vbInformation, "提示"
Else
    ' Start new instance
    WshShell.CurrentDirectory = "E:\NMDX\mimocode-max-tauri"

    ' Kill any orphaned node processes from previous runs
    WshShell.Run "cmd /c taskkill /F /IM node.exe /FI ""WINDOWTITLE eq server.js*"" 2>nul", 0, True

    ' Start dev server in background
    WshShell.Run "cmd /c node server.js", 0, False

    ' Start Tauri with Rust in PATH
    WshShell.Run "cmd /c set PATH=%PATH%;C:\Users\Oe_Lee\.cargo\bin && npx tauri dev", 0, False
End If
