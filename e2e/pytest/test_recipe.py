# The tiny project of the pytest recipe (docs/recipes/pytest.md): e2e/run.sh runs it, sends its
# JUnit report and checks that the verdict is fail.


def test_passes():
    assert 1 + 1 == 2


def test_fails():
    assert 1 + 1 == 3
