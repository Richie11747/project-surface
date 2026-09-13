# The README "Sixty seconds", recorded from a real run rather than drawn.
#
# Played by .github/workflows/demo.yml inside a fresh copy of fixtures/ts-api
# with `surface` on PATH; the workflow commits docs/demo/demo.gif. To run it
# locally: install vhs (https://github.com/charmbracelet/vhs), copy the fixture
# somewhere, delete expected.surface.json, put `surface` on PATH, and run
# `vhs <this file>` from inside the copy.

Output demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 20
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

# In CI the workflow exports DEMO_DIR (a fresh copy of fixtures/ts-api); locally run the tape from inside such a copy.
Hide
Type 'cd "${DEMO_DIR:-.}" && clear'
Enter
Show

Type "surface init"
Enter
Sleep 2.5s

Type "clear"
Enter
Type "surface inspect checkout.create"
Enter
Sleep 4s

Type "clear"
Enter
Type "surface verify --command test"
Enter
Sleep 4s
Type "surface inspect checkout.create | grep -A1 Trust"
Enter
Sleep 3s

Type "clear"
Enter
Type "sed -i '1i // touched' src/checkout/create.ts && surface init > /dev/null"
Enter
Sleep 1.5s
Type "surface doctor"
Enter
Sleep 5s
