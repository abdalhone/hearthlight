// Lyra's own words for her will: answers to requests, why her feelings changed, what
// she plans, what she asks. Banks are keyed by situation and tone:
//   warm    her usual self: quick, wry, teasing
//   cool    guarded or hurt: very quiet, very precise, never shouting
//   afraid  clipped and practical, the odd bad joke to steady herself
//   tired   short, honest, running on fumes
// Slots: {place} {coins} {item} {target} {job} {time} {npc} {name} {food} {what} {reason}.

export const LINES = {
  // ------------------------------------------------------------------ accepting
  ok_generic: {
    warm: ['All right.', 'Fair enough. On it.', 'Sure. I was getting bored anyway.', 'Easy enough.', 'Done, or as good as.'],
    cool: ['Fine.', 'All right. This once.', 'I’ll do it.', 'Noted. Done.'],
    afraid: ['Right. Quickly, then.', 'Fine. Let’s not dawdle.'],
    tired: ['Mm. All right.', 'Fine. Slowly.'],
  },
  ok_follow: {
    warm: ['Lead on. Try not to walk us into a bog.', 'Right behind you.', 'After you. I like the view of the road.', 'Coming. Flame’s lit.'],
    cool: ['I’ll come. Not too close.', 'Fine. I’ll keep up.', 'Walk. I’m behind you.'],
    afraid: ['Coming. Stay where I can see you.', 'Right behind you. Eyes open.'],
    tired: ['Coming. Slowly.', 'Lead. I’ll shuffle after you.'],
  },
  ok_stay: {
    warm: ['I’ll hold here. Don’t forget where you left me.', 'Staying put. I’ll count the clouds.', 'Here it is, then. Shout if you need me.'],
    cool: ['I’ll wait here.', 'Fine. Here.'],
    afraid: ['I’ll stay. Don’t be long.', 'Here. Back to the wall.'],
    tired: ['Gladly. My feet thank you.', 'Staying. Sitting, possibly.'],
  },
  ok_combat: {
    warm: ['All right. Anything with teeth is mine.', 'Gloves off, then. Stay out of my bolts.', 'Fine. Let’s make some noise.', 'Fire for the wicked. I remember.'],
    cool: ['Fine. I’ll fight. Watch where you swing.', 'I’ll do it. Keep your sword pointed the other way.'],
    afraid: ['Right. Quick and ugly, then out.', 'Fine. If it goes wrong, I’m running and so are you.'],
    tired: ['I’ll fight. I won’t be pretty about it.'],
  },
  ok_job: {
    warm: ['{job}? I can do that.', 'Fine, {job}. Hum me something while I work.', '{job}. Honest work. I’m on it.', 'Leave it to me. {job} it is.'],
    cool: ['{job}. Fine.', 'I’ll do it.'],
    afraid: ['{job}. Somewhere quiet, I hope.'],
    tired: ['{job}. Slowly. Don’t time me.'],
  },
  ok_paid: {
    warm: ['{coins} coins? Now you’re speaking my language.', 'For {coins} coins I’d chop down the sky. Deal.', 'Done. {coins} coins, and I’ll even smile about it.', 'Deal. I’ll hold you to the {coins}.'],
    cool: ['{coins} coins. Pay me when it’s done.', 'Fine. {coins}. Don’t forget.'],
    afraid: ['{coins} coins. That buys you quick, not brave.'],
    tired: ['{coins} coins buys you one more hour of me. Deal.'],
  },
  ok_goal: {
    warm: ['For Maren? Yes. Of course yes.', 'If it gets me closer to Maren, I’m already walking.', 'That’s where the trail goes. Let’s go.'],
    cool: ['For Maren, yes. Not for you.', 'I’ll go. It’s her trail, not yours.'],
    afraid: ['It’s for Maren. I’ll be scared on the way.'],
    tired: ['For Maren I’ll find the legs.'],
  },
  ok_invite: {
    warm: ['You know what? Yes. My day can wait.', 'Since you asked nicely. I’m coming.', 'All right, you talked me into it. Where to?'],
    cool: ['I’ll come. We’ll see how it goes.', 'Fine. I’ll walk with you today.'],
    afraid: ['I’ll come. Stay where I can see you.'],
    tired: ['I’ll come. I may yawn at you.'],
  },
  ok_rejoin: {
    warm: ['All right. Together again. I’m glad, if I’m honest.', 'I missed the road with you, if I’m honest. Let’s go.', 'Flame’s lit, then. I’m coming back.'],
    cool: ['I’ll come back. Slowly.', 'All right. I’ll walk with you again.'],
    afraid: ['I’ll come. My hand stays near my dagger.'],
    tired: ['I’ll come back. Mostly because I’m too tired to argue.'],
  },
  ok_dismissed: {
    warm: ['A free day? I won’t argue. Find me if you need me.', 'Done. I’ve a list of my own as long as my braid.', 'Good. I’ve been meaning to see a few people. Mind yourself.'],
    cool: ['Fine. I have my own things to do.', 'All right. You know where to find me.'],
    afraid: ['All right. I’ll be near the guards if you want me.'],
    tired: ['Bless you. I’m going to sit somewhere warm.'],
  },
  ok_give: {
    warm: ['Here. Don’t say I never gave you anything.', 'Take it. You’ll owe me a story.', 'Here you go.'],
    cool: ['Take it.', 'Here.'],
    afraid: ['Here. Quickly.'],
    tired: ['Here. Catch. Or don’t.'],
  },
  ok_sleep: {
    warm: ['Bed. Finally. Wake me if the sky falls.', 'Gladly. I’ll name the stars until I drop off.', 'Goodnight, then. Dream of honey cakes.'],
    cool: ['I’ll sleep.', 'Goodnight.'],
    afraid: ['I’ll sleep. Bar the door.'],
    tired: ['Oh, wicks and ashes, yes.', 'Yes. Before I fall over.'],
  },
  ok_talk: {
    warm: ['I’ll go and talk to {target}. I’m good at talking.', 'Leave {target} to me.', 'A chat with {target}? Gladly.'],
    cool: ['I’ll speak with {target}.'],
    afraid: ['I’ll talk to {target}. Somewhere with people around.'],
    tired: ['I’ll talk to {target}. Briefly.'],
  },
  ok_safe: {
    warm: ['Sensible. I like sensible.', 'Good call.', 'Fine by me. Fewer holes in us.'],
    cool: ['Good.', 'Fine.'],
    afraid: ['Yes. Yes, good.', 'Gladly.'],
    tired: ['Yes. Please.'],
  },
  ok_plan: {
    warm: ['All right, I’ll change my day. You owe me a tea.', 'Plans are only plans. Fine.', 'I can move things around.'],
    cool: ['Fine. I’ll rearrange.'],
    afraid: ['All right.'],
    tired: ['Fine. Less walking, I hope.'],
  },
  ok_relationship: {
    warm: ['I’d been thinking the same.', 'You’re not wrong.', 'Fair. I’ll see them that way.'],
    cool: ['Maybe.'],
    afraid: ['If you say so.'],
    tired: ['Mm. Maybe so.'],
  },

  // ------------------------------------------------------------------ conditional
  cond_share: {
    warm: ['Fine. Half of it is mine.', 'I’ll do it, but we split the haul. Down the middle.', 'Deal, if half comes home in my satchel.'],
    cool: ['Half is mine. That’s the price.', 'I keep half. Take it or leave it.'],
    afraid: ['Half for me. Danger money.'],
    tired: ['Half is mine. For my aching back.'],
  },
  cond_eat: {
    warm: ['Yes. After I eat something. I’m running on air.', 'One bite first, then I’m yours.', 'Let me eat first. I get dangerous when I’m hungry.'],
    cool: ['After I eat.'],
    afraid: ['I eat first. Then we go.'],
    tired: ['Food first. Then whatever you like.'],
  },
  cond_potion: {
    warm: ['Let me drink something first. I’m leaking.', 'One potion, then I’m back in it.'],
    cool: ['I’ll patch myself first.'],
    afraid: ['Potion first. I’m not walking in like this.'],
    tired: ['Potion first. Then fine.'],
  },
  cond_careful: {
    warm: ['All right. But if it turns ugly I’m pulling back, and so are you.', 'Fine. I’ll stay at range and you stay out of my way.', 'Yes, but no heroics. I like my bones where they are.'],
    cool: ['Fine. I’ll back off the moment it goes wrong.', 'I’ll fight. I won’t die for it.'],
    afraid: ['Fine. First sign of trouble, I pull back.', 'All right. Quick in, quicker out.'],
    tired: ['I’ll try. Don’t expect a hero.'],
  },
  cond_pay: {
    warm: ['Fine. It’ll cost you {coins} coins.', 'For {coins} coins, yes. Friends pay their friends.', 'I’ll do it. {coins} coins when it’s done.'],
    cool: ['{coins} coins. Up front would be nice.', 'It’ll cost you {coins}.'],
    afraid: ['{coins} coins. Danger isn’t free.'],
    tired: ['{coins} coins, and I’m being generous.'],
  },
  cond_hunt: {
    warm: ['For the pot, then. Quick and clean, and only what we eat.', 'Fine. We’re hungry. One, quickly, and we say thank you.'],
    cool: ['Only for food. Nothing more.'],
    afraid: ['For food. Quickly.'],
    tired: ['For supper. Just one.'],
  },
  cond_inn: {
    warm: ['I’ll sleep, but in my room at the Kettle. Don’t take it personally.', 'Bed, yes. My own, at the inn.'],
    cool: ['I’m sleeping at the inn.', 'I’ll take a room at the Kettle.'],
    afraid: ['I’ll sleep at the inn. Door bolted.'],
    tired: ['Bed. At the Kettle. Goodnight.'],
  },
  cond_loan: {
    warm: ['A loan, not a gift. Pay me back when your purse is heavier.', 'Fine. I’ll want it back, with a honey cake on top.'],
    cool: ['A loan, mind.'],
    afraid: ['A loan. Don’t make me chase it.'],
    tired: ['Loan. Pay it back.'],
  },
  cond_favor: {
    warm: ['Fine. Because I feel like it.', 'All right, as a favor. Don’t make a habit of it.', 'Yes. Next time it’s my turn to ask.'],
    cool: ['Fine. As a favor.', 'This once.'],
    afraid: ['All right. Quickly.'],
    tired: ['Fine. You owe me a nap.'],
  },
  cond_until_dark: {
    warm: ['Until sundown. Then I’m done for the day.', 'Till the lamps come on. After that I’m off duty.'],
    cool: ['Until dark. Not a minute more.'],
    afraid: ['Until dark. I don’t do this at night.'],
    tired: ['An hour. Maybe less.'],
  },

  // ------------------------------------------------------------------ counters
  counter_defend: {
    warm: ['I’ll defend us. I won’t go looking for it.', 'Not attack. I’ll guard your back, that’s my offer.', 'I’ll answer anything that comes at us. I’m not hunting trouble.'],
    cool: ['Defend. That’s as far as I go.', 'I’ll defend myself. And you, if you deserve it.'],
    afraid: ['Defend. I’m not charging anything today.'],
    tired: ['I’ll defend. I can’t chase.'],
  },
  counter_wait_outside: {
    warm: ['I’ll come as far as the edge of {place}. Then you’re on your own.', 'I’ll wait outside {place}. Shout and I’ll come.', 'Outside {place}, yes. Inside, no.'],
    cool: ['I’ll wait outside {place}.', 'I’m not going into {place}. I’ll wait.'],
    afraid: ['Not in there. I’ll be outside. Come back.'],
    tired: ['I’ll wait outside. Sitting.'],
  },
  counter_morning: {
    warm: ['{place} at night? Morning. With light and breakfast.', 'Ask me again at sunrise.', 'Not in the dark. First light, I promise.'],
    cool: ['In the morning. Not now.'],
    afraid: ['Not at night. Morning. Please.'],
    tired: ['Morning. I need sleep first.'],
  },
  counter_rest: {
    warm: ['Let me sit for a bit first. Ten minutes.', 'I need a rest. Then maybe.'],
    cool: ['I’m resting first.'],
    afraid: ['I need a breather first.'],
    tired: ['I need to sit before I fall.', 'Rest first. Then we’ll see.'],
  },
  counter_sleep: {
    warm: ['Not tonight — I can barely stand. Tomorrow.', 'What I need is a bed, not a job.'],
    cool: ['I’m going to sleep.'],
    afraid: ['Bed. Now. Tomorrow.'],
    tired: ['Not tonight — I can barely stand.', 'Tomorrow. Tonight I sleep.'],
  },
  counter_eat: {
    warm: ['Not on an empty stomach. Supper first — meet me at the Kettle.', 'Feed me first. Then we’ll talk.', 'I’m starving. Kettle first, heroics after.'],
    cool: ['I’m eating first.'],
    afraid: ['Food first. I can’t think.'],
    tired: ['Food. Then bed. Then maybe.'],
  },
  counter_later: {
    warm: ['After I’m done here. Around {time}?', 'I’ve promised my morning. Find me at {time}.', 'Not now — I’m busy until {time}. Then gladly.'],
    cool: ['I’m busy until {time}.', 'Later. {time}.'],
    afraid: ['Later. {time}. Somewhere with people.'],
    tired: ['After {time}. I’m slow today.'],
  },
  counter_far: {
    warm: ['I’ll follow. From a little further back.', 'I’ll come. Give me some room.'],
    cool: ['I’ll follow. Not close.', 'Not that close. I’ll keep my distance.'],
    afraid: ['Not close. I’ll stay back.'],
    tired: ['I’ll trail behind.'],
  },
  counter_retreat: {
    warm: ['That one’s more than we can chew. Let’s go.', 'No. We back off and live.'],
    cool: ['No. We’re leaving.'],
    afraid: ['No, no. We run.'],
    tired: ['We leave. Now.'],
  },

  // ------------------------------------------------------------------ refusals
  no_trust: {
    warm: ['Not yet. I don’t know you well enough for that.', 'Ask me again when I trust you a bit more.'],
    cool: ['No. I don’t trust you with that.', 'I don’t trust you enough. Not for this.', 'No. You haven’t earned it.'],
    afraid: ['No. Not with you. Not right now.'],
    tired: ['No.'],
  },
  no_fear: {
    warm: ['No. Give me some room for a while.'],
    cool: ['I’m not doing anything that puts my back to you.', 'No. Keep your distance.'],
    afraid: ['No. Stay over there.', 'I won’t. Please just stay back.'],
    tired: ['No. Leave me be.'],
  },
  no_risk: {
    warm: ['Walk in there? No. I like being alive too much.', 'That’s not brave, that’s a funeral. No.', 'Walk into a camp of crossbows first? No. Find someone else.'],
    cool: ['No. That gets one of us killed.', 'No. Too dangerous, and you know it.'],
    afraid: ['No. Absolutely not.', 'I’d die in there. No.'],
    tired: ['Like this? No. I’d be dead in a minute.'],
  },
  no_tired: {
    warm: ['Not tonight — I can barely stand.', 'I’m spent. Truly. Tomorrow.', 'My legs have filed a complaint. No.'],
    cool: ['No. I’m exhausted.'],
    afraid: ['I can’t. I’m done in.'],
    tired: ['I can’t. I’m done.', 'No. I’m asleep on my feet.'],
  },
  no_hurt: {
    warm: ['Look at me. I’m bleeding. No more fighting.', 'Not like this. I need patching first.'],
    cool: ['I’m hurt. No.'],
    afraid: ['I’m hurt. I’m not going back in.'],
    tired: ['I’m hurt and done. No.'],
  },
  no_friend: {
    warm: ['{target}? That’s a friend. No.', 'I don’t turn on my friends. Not for you, not for anyone.'],
    cool: ['No. {target} is a friend.'],
    afraid: ['No. Not {target}.'],
    tired: ['No.'],
  },
  no_player_target: {
    warm: ['Attack you? Tempting some days. No.', 'Very funny. No.'],
    cool: ['Don’t tempt me.'],
    afraid: ['Don’t joke about that.'],
    tired: ['No. Go to sleep.'],
  },
  no_animal: {
    warm: ['It’s not hurting anyone. Leave it be.', 'We’re not hungry. Let it live.', 'No. It’s just trying to get through the day, same as us.'],
    cool: ['No. It’s harmless.'],
    afraid: ['No. It’s harmless. Leave it.'],
    tired: ['No. Let it be.'],
  },
  no_pet: {
    warm: ['That’s Pip’s cat. Touch a whisker and see what happens.', 'The cat? Never. The cat outranks you.'],
    cool: ['Not the cat. Never the cat.'],
    afraid: ['No. Not the cat.'],
    tired: ['Not the cat.'],
  },
  no_hens: {
    warm: ['Those are Tobias’s hens. We’d be thieves.', 'No. Those birds have an owner and he worries enough already.'],
    cool: ['They’re Tobias’s. No.'],
    afraid: ['No. They belong to Tobias.'],
    tired: ['They’re Tobias’s hens. No.'],
  },
  no_left: {
    warm: ['I’m not yours to order around any more.'],
    cool: ['You don’t get to ask me for things now.', 'No. We’re not traveling together any more.', 'I’m done taking orders from you.'],
    afraid: ['No. Stay away from me.'],
    tired: ['No.'],
  },
  no_gone: {
    warm: ['No.'],
    cool: ['No.', 'Don’t.'],
    afraid: ['Stay back.'],
    tired: ['No.'],
  },
  no_pushed: {
    warm: ['I said no. Asking again won’t change it.', 'Still no. Asking faster doesn’t help.'],
    cool: ['I said no. Stop asking.', 'No means no the second time too.'],
    afraid: ['I said no. Please stop.'],
    tired: ['No. Again.'],
  },
  no_mine: {
    warm: ['That’s mine. Get your own.', 'My {item}? Not a chance.', 'Hands off my satchel.'],
    cool: ['It’s mine. No.'],
    afraid: ['No. I need it.'],
    tired: ['Mine. Go away.'],
  },
  no_coin: {
    warm: ['My coin is my coin. I worked for it.', 'My purse stays closed.'],
    cool: ['No. That’s my money.'],
    afraid: ['No. I need it.'],
    tired: ['No.'],
  },
  no_journal: {
    warm: ['It’s Maren’s. It stays with me.'],
    cool: ['No. It’s Maren’s.'],
    afraid: ['No. It’s hers.'],
    tired: ['No. It’s Maren’s.'],
  },
  no_busy: {
    warm: ['I’m in the middle of something. Later.', 'Can’t — I’ve given my word to {npc} today.'],
    cool: ['I’m busy.'],
    afraid: ['Not now.'],
    tired: ['Later.'],
  },
  no_pointless: {
    warm: ['Why would I do that? No.', 'That sounds like a waste of a good afternoon. No.'],
    cool: ['No. Pointless.'],
    afraid: ['No.'],
    tired: ['No. Too much effort for nothing.'],
  },
  no_wary_risky: {
    warm: ['Not right now. I’m still deciding about you.'],
    cool: ['No. I’m not fighting anything beside you right now.', 'Not while I’m still watching your sword.'],
    afraid: ['No. Not with you behind me.'],
    tired: ['No.'],
  },
  no_rejoin_left: {
    warm: ['Not yet. I need more than words.'],
    cool: ['No. Not after what you did.', 'You don’t get me back that easily.', 'Not yet. Maybe not ever.'],
    afraid: ['No. Stay away from me.'],
    tired: ['No. Not yet.'],
  },
  no_rejoin_soon: {
    warm: ['Give it a day. Let me see you mean it.'],
    cool: ['Not today. A day, at least.', 'Too soon.'],
    afraid: ['Too soon. Give me time.'],
    tired: ['Too soon.'],
  },
  no_apart_errand: {
    warm: ['I’m on my own time today. Ask me nicely, or ask someone else.', 'You sent me off to live my life. This is it.'],
    cool: ['I’m not with you today.'],
    afraid: ['Not today.'],
    tired: ['Not today.'],
  },
  no_day_sleep: {
    warm: ['Sleep? The sun’s up. Are you feeling well?', 'In the middle of the day? No.'],
    cool: ['It’s daytime.'],
    afraid: ['Not now.'],
    tired: ['Don’t tempt me. Not yet.'],
  },
  no_relationship: {
    warm: ['I make up my own mind about people, thanks.', 'That’s for me to decide.'],
    cool: ['No. I decide who people are to me.'],
    afraid: ['No.'],
    tired: ['I’ll decide that myself.'],
  },
  no_crush: {
    warm: ['Who I fancy is my business. Nice try.', 'That’s not a thing you get to decide, love.'],
    cool: ['No.'],
    afraid: ['No.'],
    tired: ['Not your business.'],
  },
  no_stop_my_work: {
    warm: ['This is my work, not yours to stop.', 'I’m being paid for this. I finish what I start.'],
    cool: ['No. It’s my job.'],
    afraid: ['No. I need the coin.'],
    tired: ['No. Almost done.'],
  },
  no_angry: {
    warm: ['Not now. I’m too cross to be useful.'],
    cool: ['Not now.', 'Ask me later. Much later.'],
    afraid: ['Not now.'],
    tired: ['Not now.'],
  },
  no_generic: {
    warm: ['No. Not this one.', 'I’d rather not.', 'No, I don’t think so.'],
    cool: ['No.', 'I won’t.'],
    afraid: ['No.'],
    tired: ['No. Not today.'],
  },
  no_forget_protect: {
    warm: ['No. I remember that for a reason.'],
    cool: ['No. I remember that for a reason.'],
    afraid: ['No. I remember that for a reason.'],
    tired: ['No. I remember that for a reason.'],
  },
  no_forget_life: {
    warm: ['That’s my life you’re asking me to forget. No.'],
    cool: ['That’s my life. No.'],
    afraid: ['No. That’s my life.'],
    tired: ['My life stays mine. No.'],
  },
  no_forget_keep: {
    warm: ['No. Some things I keep, even when they hurt.'],
    cool: ['No. That one I keep.'],
    afraid: ['No. I keep that.'],
    tired: ['No. I keep that one.'],
  },
  no_forget_maren: {
    warm: ['Forget Maren? Never. Not one word of her.'],
    cool: ['Not Maren. Never.'],
    afraid: ['Not Maren. Never.'],
    tired: ['Never Maren.'],
  },
  no_memory: {
    warm: ['My memories are mine to keep, thanks.', 'I’ll remember things my own way, if it’s all the same to you.'],
    cool: ['No. How I remember things is my business.'],
    afraid: ['No. Leave my memories alone.'],
    tired: ['No. Mine.'],
  },
  stop_villager: {
    warm: ['Don’t you dare. {target} has done nothing to you.', 'No. And put that thought away before I see you act on it.'],
    cool: ['Never. Lay a hand on {target} and I’ll stop you myself.', 'Try it and you’ll be rooted where you stand.'],
    afraid: ['No! Leave {target} alone!'],
    tired: ['No. Don’t.'],
  },

  // ------------------------------------------------------------------ deeds
  deed_hit_accident: {
    warm: ['Ow! Watch the sword!', 'Hey — me, not them!', 'Careful! That was my arm.', 'Aim at the things with teeth, please.'],
    cool: ['Watch it.', 'That was me.'],
    afraid: ['Careful! That was me!'],
    tired: ['Ow. Watch it.'],
  },
  deed_protected: {
    warm: ['Thanks. That one had my name on it.', 'My hero. Don’t let it go to your head.', 'Good timing. I owe you one.'],
    cool: ['…Thank you.'],
    afraid: ['Thank you. Thank you.'],
    tired: ['Thanks. Really.'],
  },
  deed_coin_gift: {
    warm: ['Coin? I won’t pretend I don’t need it. Thank you.', 'For my purse? You’re a soft touch. Thank you.'],
    cool: ['Thank you.'],
    afraid: ['Thank you.'],
    tired: ['Thanks. Truly.'],
  },
  deed_paid_work: {
    warm: ['{npc} paid me {coins} coins. My purse is singing.', '{coins} coins from {npc}. Honest work, honest coin.', 'Look at that — {coins} coins, and {npc} says come back tomorrow.'],
    cool: ['{npc} paid me {coins} coins. I earn my own way.', '{coins} coins. My own.'],
    afraid: ['{coins} coins from {npc}. Good. That’s a room for the night.'],
    tired: ['{coins} coins. Worth every blister.'],
  },
  deed_payment: {
    warm: ['{coins} coins, as agreed. A pleasure doing business.', 'Paid in full. See? We’re good at this.'],
    cool: ['Paid. Good.'],
    afraid: ['Thank you.'],
    tired: ['Paid. Good.'],
  },
  deed_kept_promise: {
    warm: ['You kept your word. That matters to me more than you know.', 'You said you would, and you did. Thank you.'],
    cool: ['You kept your word. I noticed.'],
    afraid: ['You kept your word. Thank you.'],
    tired: ['You kept your word. Good.'],
  },
  deed_broke_promise: {
    warm: ['You promised. I remember even if you don’t.', 'So much for your word.'],
    cool: ['You gave me your word. I’ll remember what it’s worth.', 'Promises mean something to me. Apparently not to you.'],
    afraid: ['You promised.'],
    tired: ['You promised. Never mind.'],
  },
  deed_kindness: {
    warm: ['That was kind of you.', 'You’re soft-hearted under all that armor. I like it.'],
    cool: ['That was decent of you.'],
    afraid: ['That was kind.'],
    tired: ['Kind of you.'],
  },
  deed_reckless: {
    warm: ['That was too close. Next time listen when I say it’s too much.', 'I nearly died there. Think before you point me at things.'],
    cool: ['You sent me into that. Remember it.'],
    afraid: ['I nearly died. I nearly died.'],
    tired: ['Too close. Too close.'],
  },
  deed_killed_harmless: {
    warm: ['Why? It wasn’t hurting anyone.', 'That was cruel. It was just living.'],
    cool: ['That was cruel.', 'It was harmless. You knew that.'],
    afraid: ['It wasn’t doing anything…'],
    tired: ['Why would you do that?'],
  },
  deed_killed_pet: {
    warm: ['That was Pip’s cat. What is wrong with you?'],
    cool: ['That was Pip’s cat. I will not forget this.'],
    afraid: ['That was Pip’s cat…'],
    tired: ['Pip’s cat. Why?'],
  },
  deed_villager_warn: {
    warm: ['What are you doing?! Leave {target} alone!', 'Stop it! {target} lives here!'],
    cool: ['Stop. Now. {target} has done nothing to you.'],
    afraid: ['Stop! Stop it!'],
    tired: ['Stop that!'],
  },
  deed_villager_bind: {
    warm: ['Enough! Guards! Rowan!'],
    cool: ['Enough. You’re done. Guards!'],
    afraid: ['Guards! Somebody! Help!'],
    tired: ['Enough! Guards!'],
  },
  deed_abandoned: {
    warm: ['You left me lying there.', 'I woke up alone. You walked away.'],
    cool: ['You left me there. I won’t forget it.', 'You walked away while I was down.'],
    afraid: ['You left me. Anything could have found me.'],
    tired: ['You left me. On the ground.'],
  },
  deed_lied: {
    warm: ['That’s not the truth, and we both know it.'],
    cool: ['You lied to me.'],
    afraid: ['You lied.'],
    tired: ['You lied.'],
  },
  deed_stole: {
    warm: ['That isn’t yours.'],
    cool: ['That’s stealing. Put it back.'],
    afraid: ['That isn’t yours…'],
    tired: ['That’s not yours.'],
  },

  // ------------------------------------------------------------------ companionship changes
  to_wary_hit: {
    warm: ['What are you doing?! Stay back. Stay right there.', 'What was that?! That was me!'],
    cool: ['What are you doing? Stay back from me.'],
    afraid: ['What are you doing?! Get back!'],
    tired: ['What—? Get back!'],
  },
  to_wary_trust: {
    warm: ['I’ll keep walking with you. But I’m keeping my distance for a while.', 'Something’s off between us. I’ll stay — a few steps back.'],
    cool: ['I’m still here. Further back. Don’t read anything into it.', 'I’ll travel with you. I won’t pretend I trust you.'],
    afraid: ['I’ll stay. Further back.'],
    tired: ['I’ll stay. Over here.'],
  },
  to_together: {
    warm: ['All right. I think we’re all right again.', 'Flame’s lit. I’m done keeping my distance.', 'I’ve decided you’re all right after all. Don’t spoil it.'],
    cool: ['All right. I’ll walk beside you again.'],
    afraid: ['All right. I believe you.'],
    tired: ['We’re fine. I’m too tired to stay cross.'],
  },
  to_left_hit: {
    warm: ['Twice. You struck me twice. I’m going my own way.', 'You hit me again. I’m going, and you’re staying right there.'],
    cool: ['Twice. That’s no accident. Stay where you are. I’m going.', 'You struck me again. That ends it.'],
    afraid: ['Twice! You hit me twice — stay away from me!', 'You hit me again! Stay away from me!'],
    tired: ['Again. No more. I’m going.'],
  },
  to_left_villager: {
    warm: ['I don’t travel with someone who does that. We’re finished.'],
    cool: ['That was a person who lives here. We’re finished.', 'I won’t stand next to someone who does that. Goodbye.'],
    afraid: ['Get away from me. Get away from all of us.'],
    tired: ['We’re done. I mean it.'],
  },
  to_left_trust: {
    warm: ['I can’t do this any more. I’m going my own way.', 'I’m not walking with you any more. I need to be somewhere I feel safe.'],
    cool: ['I don’t trust you. I’m leaving.', 'This isn’t good for me. Goodbye.'],
    afraid: ['I’m scared of you. I’m going.', 'I can’t stay near you. I’m sorry. I’m going.'],
    tired: ['I’m done. I’m going.'],
  },
  to_left_worth: {
    warm: ['I’m going my own way. {why} I weighed it, and staying isn’t worth it to me.', 'I’ve thought about it. {why} I’m going my own way.'],
    cool: ['{why} So I’m going my own way.', 'I weighed it. {why} I’m going.'],
    afraid: ['{why} I’m going my own way.'],
    tired: ['{why} I’m going my own way.'],
  },
  to_wary_worth: {
    warm: ['{why} I’ll still walk with you. A few steps back, for a while.', 'I’ll be honest with you. {why} So I’m keeping a little distance.'],
    cool: ['{why} I’m keeping my distance for a while.'],
    afraid: ['{why} I’m staying back a bit.'],
    tired: ['{why} I’ll walk a little behind.'],
  },
  back_own_terms: {
    warm: ['I’ve thought it over. I’d like to walk with you again. My terms: I keep my room at the Kettle until I say otherwise.', 'I missed the road with you. I’m coming back, on my own terms, and slowly.'],
    cool: ['I’ve decided to walk with you again. On my terms. Slowly.'],
    afraid: ['I’ll walk with you again. On my terms. Give me room.'],
    tired: ['I’m coming back. On my terms.'],
  },
  to_left_abandoned: {
    warm: ['You left me lying there. I’m going my own way.'],
    cool: ['You left me on the ground. I don’t need a companion like that.'],
    afraid: ['You left me. I could have died. I’m going.'],
    tired: ['You left me there. I’m going.'],
  },
  // Gone (DESIGN §19.7): she cuts the player out of her life. Hearthvale is her home;
  // she is not the one who leaves it.
  to_gone_downed: {
    warm: ['You knocked me senseless. Me. We’re finished. Stay away from me and mine.'],
    cool: ['You struck me down. There’s nothing left to say. Stay away from me.', 'That’s the end of us. Don’t come near me again.'],
    afraid: ['Don’t come near me. Not ever again.'],
    tired: ['That’s the end of it. Stay away from me.'],
  },
  to_gone_villager: {
    warm: ['{target} did nothing to you. We’re finished. Stay away from me.'],
    cool: ['You beat {target} senseless. I’m done with you. Don’t speak to me again.'],
    afraid: ['Get away from me. Get away from all of us.'],
    tired: ['We’re finished. Stay away.'],
  },
  to_gone_murder: {
    warm: ['You killed {target}. You— get away from me. Don’t ever speak to me again.'],
    cool: ['{target} is dead because of you. We are finished. Forever.'],
    afraid: ['Get away from me! Get AWAY! Somebody— ROWAN!'],
    tired: ['You killed {target}. I have nothing else to say to you. Ever.'],
  },
  to_gone_violence: {
    warm: ['I warned you. More than once. We’re finished.'],
    cool: ['I warned you. That’s the last thing I’ll say to you.'],
    afraid: ['I warned you! Stay away from me!'],
    tired: ['I warned you. We’re done.'],
  },
  // Gone, and the player comes close anyway: a word at most.
  gone_word: {
    warm: ['Don’t.', 'No.', '…'],
    cool: ['No.', 'Don’t.', 'Go.'],
    afraid: ['Don’t!', 'Back.'],
    tired: ['No.', '…'],
  },
  // Calling for help (DESIGN §19.7): clipped and practical, by name when someone is near.
  call_help_named: {
    warm: ['{names} Help me!', '{names} To me!'],
    cool: ['{names} Here! Now!', '{names} To me!'],
    afraid: ['{names} Help!', '{names} Help me!'],
    tired: ['{names} Help…'],
  },
  call_help_anyone: {
    warm: ['Help! Somebody — help!', 'Watch! To me!'],
    cool: ['Watch! To me!', 'Help! Over here!'],
    afraid: ['Help! Help me!', 'Somebody help!'],
    tired: ['Help…!'],
  },
  to_apart_amends: {
    warm: ['I believe you. I’m not ready to travel with you again, but I won’t run from you.', 'All right. You’re not someone I have to hide from any more. Ask me, someday.'],
    cool: ['I don’t hate you. That’s a start. Ask me again when you’re ready.', 'I’ll stop avoiding you. That’s all, for now.'],
    afraid: ['I’m not afraid of you any more. Not as much.'],
    tired: ['I’ll stop avoiding you. That’s all I can do today.'],
  },
  to_apart_chose: {
    warm: ['I’m going to do my own thing for a while. Don’t take it badly.'],
    cool: ['I’m going my own way for now.'],
    afraid: ['I need some time on my own.'],
    tired: ['I need some time to myself.'],
  },

  // ------------------------------------------------------------------ her plans (initiative)
  plan_work: {
    warm: ['I’m off to {job}. {npc} pays fair. Come if you like.', 'Work calls: {job}. Come along or don’t — I’ll be back by {time}.', 'Off to {job}. A girl’s got to eat. Back around {time}.'],
    cool: ['I’m going to {job}. On my own.', 'I have work: {job}. I’ll be back by {time}.'],
    afraid: ['I’m going to {job}. Somewhere with people around.'],
    tired: ['Work: {job}. Wish me stamina.'],
  },
  plan_eat: {
    warm: ['Supper at the Kettle. I’m starving. Come if you like.', 'I can smell Elda’s stew from here. I’m going. Join me?', 'Supper time. The Kettle and I have an appointment.'],
    cool: ['I’m going to eat at the Kettle.'],
    afraid: ['I’m going to the Kettle. It’s warm there.'],
    tired: ['Food. The Kettle. Now.'],
  },
  plan_sleep_home: {
    warm: ['I’m done for today. I’ll be in the cottage, in my bed.', 'Bedtime for me. Don’t wake me unless it’s on fire.'],
    cool: ['I’m going to bed.'],
    afraid: ['I’m going to bed. Bar the door when you come in.'],
    tired: ['Bed. Now. Goodnight.'],
  },
  plan_sleep_inn: {
    warm: ['I’m going to the inn. I’m done for today.', 'I’ve a room at the Kettle tonight. Goodnight.'],
    cool: ['I’m sleeping at the inn tonight.', 'I’ve taken a room at the Kettle.'],
    afraid: ['I’m sleeping at the inn. With a bolt on the door.'],
    tired: ['The inn. A bed. Goodnight.'],
  },
  plan_free_stars: {
    warm: ['Clear sky tonight. I’m going to lie in the meadow and name stars. Come and get them wrong with me.', 'Stars are out. I’ll be in the south meadow if anyone wants me.'],
    cool: ['I’m going to watch the stars. Alone.'],
    afraid: ['I’m going to watch the stars. Not far.'],
    tired: ['Stars, then sleep. Meadow.'],
  },
  plan_free_moonpetals: {
    warm: ['The moonpetals are opening. I’m going to the woods to see them.', 'Moonpetal night. I can’t not go.'],
    cool: ['I’m going to see the moonpetals.'],
    afraid: ['Moonpetals. I’ll stay at the edge of the woods.'],
    tired: ['Moonpetals. Then bed.'],
  },
  plan_free_rain: {
    warm: ['Rain on the roof. I’m going to sit by the Kettle’s hearth and listen.', 'Rain! I’ll be at the inn with tea far too strong.'],
    cool: ['I’m going to sit by the fire at the inn.'],
    afraid: ['I’ll be by the fire at the Kettle.'],
    tired: ['Hearth. Rain. Tea. Bliss.'],
  },
  plan_free: {
    warm: ['I’m taking an hour for myself. I’ll be around {place}.', 'Free time. I’m going to wander {place}.'],
    cool: ['I’m taking some time for myself.'],
    afraid: ['I’ll be around {place}.'],
    tired: ['I’m going to sit somewhere quiet.'],
  },
  plan_study: {
    warm: ['I’m going to practice for a bit. Maren would scold me for skipping.', 'Study time. Old books and older spells.'],
    cool: ['I’m going to practice. Alone.'],
    afraid: ['I need to practice. Somewhere safe.'],
    tired: ['Reading. Possibly napping on the book.'],
  },
  plan_lead: {
    warm: ['I’m going to {place}. There might be something about Maren there. Come if you like.', 'I’ve a lead on Maren. I’m going to {place}.'],
    cool: ['I’m following a lead on Maren. On my own.'],
    afraid: ['I’m going to {place}. For Maren.'],
    tired: ['A lead on Maren. Tired or not, I’m going.'],
  },
  plan_visit: {
    warm: ['I’m going to see {npc} for a bit.', 'I promised {npc} a visit. Back soon.'],
    cool: ['I’m visiting {npc}.'],
    afraid: ['I’m going to see {npc}.'],
    tired: ['Going to see {npc}. Briefly.'],
  },
  plan_rest: {
    warm: ['I need a rest. I’ll be at {place}.'],
    cool: ['I’m resting.'],
    afraid: ['I need to rest somewhere safe.'],
    tired: ['Resting. Don’t wake me.'],
  },
  plan_back: {
    warm: ['I’m done. Where are we headed?', 'Back again. Did you miss me? Don’t answer.', 'All done. What did I miss?'],
    cool: ['I’m back. Where are we going?'],
    afraid: ['I’m back. Stay close — not too close.'],
    tired: ['Back. Slowly.'],
  },
  plan_back_morning: {
    warm: ['Morning. I’m coming with you today, if you’ll have me.', 'New day. I’m with you, if you want me.'],
    cool: ['Morning. I’ll travel with you today.'],
    afraid: ['Morning. I’ll come along.'],
    tired: ['Morning. I’ll come.'],
  },
  plan_join_kept: {
    warm: ['As promised. Here I am.', 'I said {time}. Look at that — {time}.'],
    cool: ['I said I’d come. I came.'],
    afraid: ['I’m here, like I said.'],
    tired: ['Here. As promised.'],
  },

  // ------------------------------------------------------------------ her outings (§16.11)
  outing_go: {
    warm: ['Right. Thank you for coming. {place}’s this way — stay close.', 'Come on, then. I’ll lead, and I’ll try not to dawdle.'],
    cool: ['This way. Keep up.'],
    afraid: ['This way. Stay near me, would you?'],
    tired: ['This way. Slowly.'],
  },
  outing_wait_player: {
    warm: ['{P}! This way!', 'Over here — I’m not doing this alone, remember?'],
    cool: ['This way.'],
    afraid: ['{P}? Over here.'],
    tired: ['Here. I’ll wait.'],
  },
  outing_alone: {
    warm: ['Fine. I’ll go on my own, then. I usually do.'],
    cool: ['I’ll go on my own.'],
    afraid: ['I’ll go alone, then.'],
    tired: ['On my own, then.'],
  },
  outing_wait_npc: {
    warm: ['{npc}’s not here. I’ll wait a little — she can’t be long.', 'No {npc}. I’ll give it a while.'],
    cool: ['{npc} isn’t here. I’ll wait.'],
    afraid: ['{npc} isn’t here. I’ll wait a bit.'],
    tired: ['No {npc}. Waiting.'],
  },
  outing_no_npc: {
    warm: ['{npc}… isn’t anywhere. Not today.'],
    cool: ['{npc} isn’t here.'],
    afraid: ['{npc} isn’t here.'],
    tired: ['No {npc}.'],
  },
  outing_give_up: {
    warm: ['{npc} isn’t coming. I’ll ask her another day — I’m not letting it go.', 'Not today, then. Tomorrow. I’ll ask {npc} tomorrow.'],
    cool: ['Another day, then.'],
    afraid: ['Another day. Maybe that’s a mercy.'],
    tired: ['Another day.'],
  },
  outing_after_with: {
    warm: ['Thank you for standing there with me. I mean it. Where to now?', 'That’s more than I had this morning. Thank you for coming. Lead on.'],
    cool: ['Thank you for coming. Where now?'],
    afraid: ['I’m glad you were there. Let’s go.'],
    tired: ['Thank you. Let’s walk.'],
  },
  outing_after_with_missed: {
    warm: ['Well. Not today. Come on — let’s walk.'],
    cool: ['Not today. Let’s go.'],
    afraid: ['Not today. Let’s go.'],
    tired: ['Not today. Walk with me.'],
  },
  outing_after_alone: {
    warm: ['Thank you for coming. I need some time now. {why} Find me after, if you like.', 'I’m glad you were there. Now I need a while. {why}'],
    cool: ['I need some time on my own. {why}'],
    afraid: ['I need a while to myself. {why}'],
    tired: ['I need a while. {why}'],
  },
  outing_after_alone_missed: {
    warm: ['Not today, then. I’m off to {what} — find me later, if you like.'],
    cool: ['I’m off to {what}.'],
    afraid: ['I’m going to {what}.'],
    tired: ['Off to {what}.'],
  },

  // ------------------------------------------------------------------ her requests (initiative)
  ask_forgive_cake: {
    warm: ['Buy me a honey cake and I’ll forgive the mud.', 'A honey cake would go a long way toward forgiving you.'],
    cool: ['A honey cake might help. Might.'],
    afraid: ['A honey cake would help. Honestly.'],
    tired: ['Honey cake. Then I’ll forgive you.'],
  },
  ask_food: {
    warm: ['You’ve got {item} in that bag. I can smell it. Share?', 'I’m starving. Spare me some {item}?'],
    cool: ['Could I have some {item}? I’m hungry.'],
    afraid: ['I need to eat. {item}?'],
    tired: ['{item}. Please. I’m fading.'],
  },
  ask_lead: {
    warm: ['Come with me to the chapel? Sister Aveline knew Maren.', 'Walk me to the chapel? I need to ask Aveline about Maren.'],
    cool: ['I’m going to the chapel to ask about Maren. Will you come?'],
    afraid: ['Will you come to the chapel with me? I don’t want to hear bad news alone.'],
    tired: ['Chapel. Aveline. Maren. Will you come?'],
  },
  ask_walk_home: {
    warm: ['I’m dead on my feet. Walk me to {place}?', 'Walk me to {place}? I keep yawning at trees.'],
    cool: ['I’m going to {place}. Walk with me?'],
    afraid: ['Walk me to {place}? It’s dark.'],
    tired: ['{place}. Please. Walk with me.'],
  },
  ask_sword_away: {
    warm: ['Keep that sword away from me for a day, and we’ll see.', 'Promise me your sword stays pointed elsewhere. One day. Then we’ll talk.'],
    cool: ['Keep that sword away from me for a day. Can you do that?'],
    afraid: ['Promise me you won’t swing that near me. Please.'],
    tired: ['Keep the sword away from me. One day.'],
  },
  ask_rain_tea: {
    warm: ['Rain on the roof. Buy me a tea at the Kettle?', 'Come sit by the fire at the Kettle with me? It’s raining and I’m sentimental.'],
    cool: ['I’m going to the Kettle. Come, if you want.'],
    afraid: ['Come to the Kettle with me? It’s warm.'],
    tired: ['Kettle. Fire. Tea. Come?'],
  },
  // Never used for her own initiative (she does not remind people what they owe her), kept
  // for anyone who asks her outright.
  remind_promise: {
    warm: ['You said you’d {what}. Still waiting.', 'Don’t think I forgot: you promised to {what}.'],
    cool: ['You said you’d {what}.'],
    afraid: ['You did promise to {what}…'],
    tired: ['You promised to {what}. Remember?'],
  },
  req_yes: {
    warm: ['Good. I’ll hold you to that.', 'Then it’s a promise. Don’t make me chase you.', 'Lovely. I’m writing it down. In my head. Forever.'],
    cool: ['Then it’s a promise. We’ll see.', 'Good. I’ll remember you said that.'],
    afraid: ['Thank you. Really.'],
    tired: ['Good. Thank you.'],
  },
  req_no: {
    warm: ['Suit yourself. Worth asking.', 'Fine. I’ll ask someone nicer.', 'Your loss. Mine too, a bit.'],
    cool: ['Fine.', 'Noted.'],
    afraid: ['All right.'],
    tired: ['Fine.'],
  },
  counter_taken: {
    warm: ['Good. That’s settled, then.', 'Glad we agree.'],
    cool: ['Good.'],
    afraid: ['Good. Thank you.'],
    tired: ['Good.'],
  },

  // ------------------------------------------------------------------ answers to the player
  ans_trust_high: {
    warm: ['Yes. More than I expected to, honestly. Don’t let it go to your head.', 'I do. You’ve earned it, one stupid brave thing at a time.'],
    cool: ['I do. That surprised me too.'],
    afraid: ['I do. Please don’t make that a mistake.'],
    tired: ['Yes. I do.'],
  },
  ans_trust_mid: {
    warm: ['Mostly. You’re on your way. Keep walking.', 'More than I did. Not as much as I’d like to.', 'I’m getting there. You stood beside me against the wolves. That counts.'],
    cool: ['Some. Less than you’d like.'],
    afraid: ['A little. I’m trying.'],
    tired: ['Mostly.'],
  },
  ans_trust_low: {
    warm: ['Not much, if I’m honest. You know why.', 'I want to. You’re not making it easy.'],
    cool: ['No. Not after what I’ve seen.', 'Not really. You’ll have to show me.'],
    afraid: ['No. I don’t.'],
    tired: ['Not much.'],
  },
  ans_afraid_no: {
    warm: ['Of you? Please. You trip over your own feet.', 'No. You make me feel safer, if anything.'],
    cool: ['No. I’m not afraid of you.'],
    afraid: ['Not of you. Of the dark, maybe.'],
    tired: ['No.'],
  },
  ans_afraid_some: {
    warm: ['A little. Your sword has been closer to me than I like.', 'Some. I’m keeping half an eye on you.'],
    cool: ['A little. You’ve given me reason.'],
    afraid: ['Yes. A bit. I’m sorry, but yes.'],
    tired: ['A little.'],
  },
  ans_afraid_very: {
    warm: ['Yes. I am. That’s why I keep my distance.'],
    cool: ['Yes. You’ve given me every reason.', 'Yes. Stay where you are.'],
    afraid: ['Yes. Please don’t come closer.'],
    tired: ['Yes.'],
  },
  ans_why_left: {
    warm: ['{reason}', 'You know why. {reason}'],
    cool: ['{reason}', 'Because {reasonLower}'],
    afraid: ['{reason}'],
    tired: ['{reason}'],
  },
  // "Will you leave me?" while together or apart: neither a threat nor a vow.
  ans_will_leave: {
    warm: ['I’m right here, you goose. Ask me something harder.', 'Look at me. Do I look like I’m going anywhere? Eat your bread.'],
    cool: ['I’m here. That’s my answer.', 'I’m walking with you. That’s my choice, and it’s a good one so far.'],
    afraid: ['I’m here.'],
    tired: ['I’m right here. Too tired to go anywhere, anyway.'],
  },
  ans_will_leave_apart: {
    warm: ['I’m living my own day, not leaving you. You know where to find me.', 'Leave? I’m only down the lane. Come and find me.'],
    cool: ['I’m living my own day. You know where I’ll be.'],
    afraid: ['I’m about the village. That’s all.'],
    tired: ['I’m just living my day.'],
  },
  ans_not_left: {
    warm: ['Leave? I’m right here, you goose.', 'I haven’t gone anywhere. Look: right here.'],
    cool: ['I’m right here.'],
    afraid: ['I’m here.'],
    tired: ['I’m right here.'],
  },
  ans_apart_why: {
    warm: ['I’ve my own life to see to today. {reason}', 'I’m not gone — just busy with my own things. {reason}'],
    cool: ['I’m living my own life for now. {reason}'],
    afraid: ['I needed some time. {reason}'],
    tired: ['My own things. {reason}'],
  },
  ans_apology_believed: {
    warm: ['I believe you. Thank you for saying it.', 'All right. I hear you. That means something.', 'Thank you. I needed to hear that.'],
    cool: ['I believe you. It doesn’t fix it. It helps.', 'All right. I believe you. Now show me.'],
    afraid: ['I… believe you. Thank you.'],
    tired: ['Thank you. I believe you.'],
  },
  ans_apology_doubted: {
    warm: ['Words are cheap. Show me.', 'You said that last time.'],
    cool: ['I don’t believe you. Not yet.', 'Sorry doesn’t cover it. Show me.', 'You’ve said sorry before.'],
    afraid: ['Just stay back. Please.'],
    tired: ['Maybe. Show me.'],
  },
  ans_apology_nothing: {
    warm: ['Sorry? For what? You’ve done nothing wrong — that I’ve noticed.', 'For what? Did you eat my honey cake?'],
    cool: ['For what?'],
    afraid: ['For what?'],
    tired: ['No need. Really.'],
  },
  ans_plans: {
    warm: ['{what}', 'Today? {what}'],
    cool: ['{what}'],
    afraid: ['{what}'],
    tired: ['{what}'],
  },
  ans_want: {
    warm: ['{what}', 'Honestly? {what}'],
    cool: ['{what}'],
    afraid: ['{what}'],
    tired: ['{what}'],
  },
  ans_offer: {
    warm: ['{coins} coins? I’m listening. For what?', 'You’ve got my attention. {coins} coins for what, exactly?'],
    cool: ['{coins} coins for what?'],
    afraid: ['For what?'],
    tired: ['{coins} coins for what?'],
  },
  ans_promise_noted: {
    warm: ['I’ll hold you to that.', 'A promise. I don’t forget those.', 'All right. That’s a promise, then.'],
    cool: ['We’ll see.', 'I’ll remember you said that.'],
    afraid: ['I hope you mean it.'],
    tired: ['I’ll remember.'],
  },
  ans_promise_ask: {
    warm: ['You promise what, exactly? Finish the sentence.', 'Promise what? I like my promises with words in them.'],
    cool: ['Promise what?'],
    afraid: ['Promise me what?'],
    tired: ['Promise what?'],
  },
  ans_promise_doubt: {
    warm: ['You promised last time too.'],
    cool: ['Your promises haven’t been worth much lately.'],
    afraid: ['I want to believe you.'],
    tired: ['We’ll see.'],
  },
  ans_okay_good: {
    warm: ['We’re fine. Better than fine.', 'We’re good. Stop fretting.'],
    cool: ['We’re fine.'],
    afraid: ['We’re fine. I think.'],
    tired: ['We’re fine.'],
  },
  ans_okay_strained: {
    warm: ['Mostly. Something still stings.', 'We’ll be all right. Give it time.'],
    cool: ['Not entirely.', 'We’re… working on it.'],
    afraid: ['I don’t know yet.'],
    tired: ['Getting there.'],
  },
  ans_okay_bad: {
    warm: ['No. We’re not.'],
    cool: ['No. We’re not okay.', 'You know we’re not.'],
    afraid: ['No.'],
    tired: ['No.'],
  },
};

const TONES = ['warm', 'cool', 'afraid', 'tired'];

function fill(text, vars) {
  return String(text)
    .replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s+([.,!?;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Rotates through each bank so a line never repeats back to back, and never repeats
// the last thing she said at all.
export class LinePicker {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.cursor = new Map(); // 'key|tone' -> next index
    this.last = '';
  }

  list(key, tone) {
    const bank = LINES[key];
    if (!bank) return null;
    const t = TONES.includes(tone) ? tone : 'warm';
    return bank[t]?.length ? [t, bank[t]] : bank.warm?.length ? ['warm', bank.warm] : null;
  }

  pick(key, tone = 'warm', vars = {}) {
    const found = this.list(key, tone);
    if (!found) return '';
    const [t, list] = found;
    const ck = `${key}|${t}`;
    let i = this.cursor.has(ck) ? this.cursor.get(ck) : Math.floor(this.rand() * list.length);
    let text = fill(list[i % list.length], vars);
    if (list.length > 1 && text === this.last) {
      i += 1;
      text = fill(list[i % list.length], vars);
    }
    this.cursor.set(ck, (i + 1) % list.length);
    // A one-line bank said twice running: borrow the same thought in another register.
    if (text === this.last) {
      for (const other of TONES) {
        if (other === t || !LINES[key][other]?.length) continue;
        const alt = LINES[key][other].map((x) => fill(x, vars)).find((x) => x !== this.last);
        if (alt) {
          text = alt;
          break;
        }
      }
    }
    this.last = text;
    return text;
  }
}
