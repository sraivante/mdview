' MDVIEW launcher — starts the server silently (if not already running) and opens the browser.
' Optional argument: a markdown file to open (used by Windows "Open with").
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node server.js", 0, False
WScript.Sleep 1200
If WScript.Arguments.Count > 0 Then
  sh.Run "cmd /c node """ & dir & "\scripts\open-url.js"" """ & WScript.Arguments(0) & """", 0, False
Else
  sh.Run "http://localhost:4200"
End If
