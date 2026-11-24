# People and conductors

Your user: `bakers_user_read`, read once per run ([read ticket](read-ticket.md)); retain it.
Position and background, from the `profiles` entry of the ticket's workspace, say who they are;
team `role` says what they may do. `user` (e-mail or username) reads another visible user.

Pass people and conductors by UUID only, from `bakers_user_read` or ticket outputs.

*My conductor* = your user's conductors in the ticket's project, from `bakers_user_read` alone.
Exactly one `online`: use it. Zero or several: ask, listing each with its machine. The run's own
conductor is the one whose `conductor_id` equals `$BAKERS_CONDUCTOR_ID`.

Before setting someone else's conductor, check its `assignment` (`bakers_conductor_list` shows it
with the `owner`). `forbid`: say so, name the owner, set no conductor; the owner alone lifts it,
never an added reviewer.
