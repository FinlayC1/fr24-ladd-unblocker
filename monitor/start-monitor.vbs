' FR24 LADD unblocker - starts the permanent monitor with no window (log: monitor.log beside this file)
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node """ & dir & "\monitor.cjs"" >> """ & dir & "\monitor.log"" 2>&1", 0, False
