import { describe, it, expect, vi } from 'vitest'
import { createFetchBans, createFetchFriendList } from '../src/steam/api.js'

function fakeFetch(payload, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => payload })
}

describe('createFetchBans', () => {
  it('lista vazia: não chama a API', async () => {
    const fetchImpl = fakeFetch({ players: [] })
    const fetchBans = createFetchBans('key', fetchImpl)
    expect(await fetchBans([])).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('mapeia os campos da Steam pro formato do site', async () => {
    const fetchImpl = fakeFetch({
      players: [
        { SteamId: '765', VACBanned: true, NumberOfVACBans: 2, DaysSinceLastBan: 30, NumberOfGameBans: 1, CommunityBanned: false },
      ],
    })
    const fetchBans = createFetchBans('key', fetchImpl)
    const res = await fetchBans(['765'])
    expect(res).toEqual([
      { steamId: '765', vacBanned: true, numVacBans: 2, daysSinceLastBan: 30, gameBanned: true, numGameBans: 1, communityBanned: false },
    ])
  })

  it('cacheia por TTL: 2ª chamada com o mesmo conjunto de steamids não bate na API de novo', async () => {
    const fetchImpl = fakeFetch({ players: [{ SteamId: '765', VACBanned: false, NumberOfVACBans: 0, DaysSinceLastBan: 0, NumberOfGameBans: 0, CommunityBanned: false }] })
    const fetchBans = createFetchBans('key', fetchImpl)
    await fetchBans(['765'])
    await fetchBans(['765'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falha de rede: devolve [] (ou o cache anterior) em vez de derrubar a rota', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'))
    const fetchBans = createFetchBans('key', fetchImpl)
    expect(await fetchBans(['765'])).toEqual([])
  })
})

describe('createFetchFriendList', () => {
  it('mapeia friendslist.friends pra lista de steamids', async () => {
    const fetchImpl = fakeFetch({ friendslist: { friends: [{ steamid: '111', relationship: 'friend', friend_since: 1 }, { steamid: '222', relationship: 'friend', friend_since: 2 }] } })
    const fetchFriendList = createFetchFriendList('key', fetchImpl)
    expect(await fetchFriendList('765')).toEqual(['111', '222'])
  })

  it('perfil privado (401): devolve [] em vez de derrubar o login', async () => {
    const fetchImpl = fakeFetch({}, false)
    const fetchFriendList = createFetchFriendList('key', fetchImpl)
    expect(await fetchFriendList('765')).toEqual([])
  })

  it('falha de rede: devolve []', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'))
    const fetchFriendList = createFetchFriendList('key', fetchImpl)
    expect(await fetchFriendList('765')).toEqual([])
  })
})
