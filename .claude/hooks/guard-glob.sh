#!/usr/bin/env bash
# PreToolUse (Bash): block a command with an unquoted glob that matches no file. The Bash tool runs
# in the person's zsh, which stops the whole command with "no matches found" before anything runs
# (`grep -rn x --include=*.md .` is the usual case). HV-1, AC9. Exit 2 = block; stderr names the
# word and prints the command with it quoted.
# Not checked: heredoc bodies, comments, quoted text, words with a $ expansion, `[[ … ]]`,
# `(( … ))`, assignments, and commands with `case`, `noglob` or `setopt nullglob`/`nonomatch`.
# After a `cd` only `--opt=glob` words are checked (they never match a file wherever you are).
# Tests: .claude/hooks/guard-glob.test.sh.
command -v jq >/dev/null 2>&1 || { echo "guard-glob.sh: jq is missing (brew install jq)." >&2; exit 1; }
input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
case "$cmd" in *'*'* | *'?'* | *'['*) ;; *) exit 0 ;; esac
cwd=$(jq -r '.cwd // ""' <<<"$input")

GUARD_CMD="$cmd" GUARD_CWD="${cwd:-$PWD}" exec perl -e '
use strict;
use warnings;
use File::Glob qw(:bsd_glob);

my ($cmd, $cwd) = ($ENV{GUARD_CMD}, $ENV{GUARD_CWD});
exit 0 if $cmd =~ /\b(?:noglob|case)\b/ || $cmd =~ /setopt\s+[^;&|\n]*\b(?:null_?glob|no_?nomatch)\b/i;
chdir $cwd if $cwd ne "" && -d $cwd;

my $n = length $cmd;
my $i = 0;
my (@words, %w, @heredocs);
my $inword = 0;

sub lit { # quoted or escaped text: literal in the value, escaped in the glob pattern
  my ($s) = @_;
  $w{val} .= $s;
  (my $p = $s) =~ s/([*?\[\]{}\\])/\\$1/g;
  $w{pat} .= $p;
}
sub end_word { $w{end} = $i; push @words, {%w}; $inword = 0; }
sub skip_to { my ($close) = @_; my $j = index($cmd, $close, $i); $i = $j < 0 ? $n : $j + length $close; }

while ($i < $n) {
  my $c = substr($cmd, $i, 1);
  if (!$inword) {
    if ($c eq "\n") {
      $i++;
      for my $delim (@heredocs) { # skip the body up to its closing line
        while ($i < $n) {
          my $j = index($cmd, "\n", $i);
          $j = $n if $j < 0;
          my $line = substr($cmd, $i, $j - $i);
          $i = $j + 1;
          $line =~ s/^\t+//;
          last if $line eq $delim;
        }
      }
      @heredocs = ();
      next;
    }
    if ($c =~ /[ \t]/) { $i++; next; }
    if ($c eq "#") { my $j = index($cmd, "\n", $i); $i = $j < 0 ? $n : $j; next; }
    if (substr($cmd, $i, 3) eq "<<<") { $i += 3; next; }
    if (substr($cmd, $i, 2) eq "<<") {
      $i += 2;
      $i++ if substr($cmd, $i, 1) eq "-";
      $i++ while $i < $n && substr($cmd, $i, 1) =~ /[ \t]/;
      my $d = "";
      while ($i < $n && substr($cmd, $i, 1) !~ /[\s;&|<>()]/) { $d .= substr($cmd, $i, 1); $i++; }
      $d =~ s/["\x27\\]//g;
      push @heredocs, $d if $d ne "";
      next;
    }
    if (substr($cmd, $i, 3) eq "\$((") { skip_to("))"); next; }
    if (substr($cmd, $i, 2) eq "((") { skip_to("))"); next; }
    if (substr($cmd, $i, 2) eq "\$(") { $i += 2; next; }
    if ($c =~ /[;&|<>()\x60]/) { $i++; next; }
    %w = (start => $i, val => "", pat => "", glob => 0, dollar => 0);
    $inword = 1;
  }
  if ($c =~ /[ \t\n;&|<>()\x60]/) { end_word(); next; }
  if ($c eq "\\") {
    my $d = substr($cmd, $i + 1, 1);
    lit($d) if $d ne "\n";
    $i += 2;
    next;
  }
  if ($c eq "\x27") {
    my $j = index($cmd, "\x27", $i + 1);
    $j = $n if $j < 0;
    lit(substr($cmd, $i + 1, $j - $i - 1));
    $i = $j + 1;
    next;
  }
  if ($c eq "\"") {
    my $j = $i + 1;
    my $s = "";
    while ($j < $n && substr($cmd, $j, 1) ne "\"") {
      if (substr($cmd, $j, 1) eq "\\") { $s .= substr($cmd, $j + 1, 1); $j += 2; next; }
      $s .= substr($cmd, $j, 1);
      $j++;
    }
    $w{dollar} = 1 if $s =~ /[\$\x60]/;
    lit($s);
    $i = $j + 1;
    next;
  }
  if ($c eq "\$") {
    $w{dollar} = 1;
    if (substr($cmd, $i + 1, 1) eq "(") { end_word(); next; }
    $w{val} .= $c; $w{pat} .= $c; $i++;
    next;
  }
  $w{glob} = 1 if $c =~ /[*?\[]/;
  $w{val} .= $c;
  $w{pat} .= $c;
  $i++;
}
end_word() if $inword;

my ($in_test, $after_cd, @bad) = (0, 0);
for my $w (@words) {
  my $raw = substr($cmd, $w->{start}, $w->{end} - $w->{start});
  if ($raw eq "[[") { $in_test = 1; next; }
  if ($raw eq "]]") { $in_test = 0; next; }
  $after_cd = 1 if $raw eq "cd" || $raw eq "pushd";
  next if $in_test || !$w->{glob} || $w->{dollar};
  next if $raw eq "[" || $raw eq "]";
  next if $w->{val} =~ /^[A-Za-z_][A-Za-z0-9_]*=/;
  my $opt_glob = $w->{val} =~ /^-[^=*?\[]*=/;
  next if $after_cd && !$opt_glob;
  next if !$opt_glob && bsd_glob($w->{pat}, GLOB_BRACE | GLOB_QUOTE | GLOB_TILDE | GLOB_NOSORT);
  push @bad, [$w, $raw];
}
exit 0 unless @bad;

sub quote { my ($s) = @_; $s =~ s/\x27/\x27\\\x27\x27/g; return "\x27$s\x27"; }
my $fixed = $cmd;
for my $b (reverse @bad) {
  my ($w) = @$b;
  my $q = $w->{val} =~ /^(-[^=*?\[]*=)(.*)$/s ? $1 . quote($2) : quote($w->{val});
  substr($fixed, $w->{start}, $w->{end} - $w->{start}) = $q;
}
my $list = join ", ", map { $_->[1] } @bad;
print STDERR "Blocked: zsh stops the whole command on an unquoted glob that matches no file (no matches found: $list), so nothing would run. Quote the pattern and run this instead:\n$fixed\n";
exit 2;
'
