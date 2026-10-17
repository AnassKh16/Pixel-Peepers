# push.ps1 - commit everything with a timestamp, sync with teammates (pull --rebase), push,
# then confirm GitHub has the commit.
# Usage (from the repo root):   .\push.ps1            or   .\push.ps1 "short note"
# If Windows blocks scripts:    powershell -ExecutionPolicy Bypass -File .\push.ps1
#
# Order is commit -> pull --rebase -> push. Pulling first with uncommitted changes would fail,
# so we commit locally first. pull --rebase only replays OUR new, unpushed commits on top of
# GitHub's; it never rewrites commits already on GitHub.

param([string]$Note = "")

$now = Get-Date
$stamp = $now.ToString("yyyy-MM-dd HH:mm:ss")

# --- Safety: refuse pushes when the rules forbid them (laptop clock, PKT) ---
if ($now -lt (Get-Date "2026-10-17 10:45:00")) {
    Write-Host "BLOCKED: repo must stay empty until Sprint 1 starts at 10:45 AM Sat." -ForegroundColor Red
    exit 1
}
if ($now -ge (Get-Date "2026-10-17 15:05:00") -and $now -lt (Get-Date "2026-10-18 10:15:00")) {
    Write-Host "BLOCKED: no pushes between 3:05 PM Sat and 10:15 AM Sun." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".git")) {
    Write-Host "ERROR: run this from the root of the repo folder." -ForegroundColor Red
    exit 1
}

# --- 1. Commit local work ---
git add -A
$msg = "Checkpoint $stamp"
if ($Note) { $msg = "$msg - $Note" }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m $msg
    if ($LASTEXITCODE -ne 0) { Write-Host "COMMIT FAILED" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "Nothing new to commit; will still sync and push." -ForegroundColor Yellow
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()

# --- 2. Get teammates' commits (skipped on the very first push, when GitHub has no branch yet) ---
git ls-remote --exit-code --heads origin $branch *> $null
if ($LASTEXITCODE -eq 0) {
    git pull --rebase origin $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host "PULL --REBASE HIT A CONFLICT. Nothing was pushed." -ForegroundColor Red
        Write-Host "Fix the files git lists, then: git add <file> ; git rebase --continue ; .\push.ps1" -ForegroundColor Red
        Write-Host "Or give up this rebase safely with: git rebase --abort" -ForegroundColor Red
        exit 1
    }
}

# --- 3. Push ---
git push -u origin $branch
$pushOk = ($LASTEXITCODE -eq 0)

# --- 4. Confirm GitHub has our latest commit ---
$local  = (git rev-parse HEAD).Trim()
$remote = ((git ls-remote origin "refs/heads/$branch") -split "\s+")[0]

Write-Host ""
Write-Host "Time (laptop):  $(Get-Date -Format 'HH:mm:ss')"
Write-Host "Branch:         $branch"
Write-Host "Local commit:   $local"
Write-Host "GitHub commit:  $remote"
if ($pushOk -and $local -eq $remote) {
    Write-Host "PUSH OK - GitHub has your latest commit." -ForegroundColor Green
} else {
    Write-Host "PUSH FAILED - GitHub does NOT have your latest commit. Fix this now." -ForegroundColor Red
    exit 1
}
