"""Shared candidate scorer: no rule bot or search is used at inference time."""
import torch
import copy
from torch import nn
from sb3_contrib.common.maskable.policies import MaskableActorCriticPolicy
from bridge import GLOBAL_SIZE, CANDIDATE_SIZE, ACTION_COUNT


class CandidateExtractor(nn.Module):
    latent_dim_pi = ACTION_COUNT
    latent_dim_vf = 128

    def __init__(self):
        super().__init__()
        self.context = nn.Sequential(nn.Linear(GLOBAL_SIZE, 256), nn.Tanh(), nn.Linear(256, 128), nn.Tanh())
        self.candidate = nn.Sequential(nn.Linear(CANDIDATE_SIZE, 64), nn.Tanh())
        self.scorer = nn.Sequential(nn.Linear(192, 128), nn.Tanh(), nn.Linear(128, 1))

    def context_features(self,features):
        return features[:,:GLOBAL_SIZE]

    def forward_actor(self, features):
        context = self.context(self.context_features(features))
        candidates = features[:, GLOBAL_SIZE:].reshape(-1, ACTION_COUNT, CANDIDATE_SIZE)
        local = self.candidate(candidates)
        context = context.unsqueeze(1).expand(-1, ACTION_COUNT, -1)
        return self.scorer(torch.cat((context, local), dim=-1)).squeeze(-1)

    def forward_critic(self, features):
        return self.context(self.context_features(features))

    def forward(self, features):
        return self.forward_actor(features), self.forward_critic(features)


class SkyloPolicy(MaskableActorCriticPolicy):
    def _build_mlp_extractor(self):
        self.mlp_extractor = CandidateExtractor()

    def _build(self, lr_schedule):
        super()._build(lr_schedule)
        self.action_net = nn.Identity()
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)


class SeparatedCandidateExtractor(CandidateExtractor):
    """The critic cannot change the actor's state embedding through value loss."""
    def __init__(self):
        super().__init__()
        self.value_context=copy.deepcopy(self.context)

    def forward_critic(self,features):
        return self.value_context(self.context_features(features))


class SeparatedSkyloPolicy(SkyloPolicy):
    def _build_mlp_extractor(self):
        self.mlp_extractor=SeparatedCandidateExtractor()


class EnrichedCandidateExtractor(SeparatedCandidateExtractor):
    """Public arithmetic summaries help the network compare pickup options.

    These are raw point gains/counts, with no teacher scoring or fixed strategy.
    The same 1426 fair inputs remain the complete deployed model interface.
    """
    def __init__(self):
        super().__init__()
        self.context=nn.Sequential(nn.Linear(GLOBAL_SIZE+20,256),nn.Tanh(),nn.Linear(256,128),nn.Tanh())
        self.value_context=copy.deepcopy(self.context)
        self.register_buffer('card_values',torch.arange(-2,13).float()/12,persistent=False)

    def context_features(self,features):
        slots=features[:,:216].reshape(-1,4,3,18)
        value,known,exists=slots[:,:,:,0],slots[:,:,:,1],slots[:,:,:,2]
        mean=features[:,512].reshape(-1,1,1)
        expected=(value*known+mean*(1-known))*exists
        maximum=torch.where(exists>0,expected,-torch.ones_like(expected)*2).flatten(1).max(dim=1).values
        minimum=torch.where(exists>0,expected,torch.ones_like(expected)*2).flatten(1).min(dim=1).values
        has_board=exists.flatten(1).sum(dim=1)>0
        maximum=torch.where(has_board,maximum,torch.zeros_like(maximum));minimum=torch.where(has_board,minimum,torch.zeros_like(minimum))
        max_known=torch.where(known>0,value,-torch.ones_like(value)*2).flatten(1).max(dim=1).values
        min_known=torch.where(known>0,value,torch.ones_like(value)*2).flatten(1).min(dim=1).values
        has_known=known.flatten(1).sum(dim=1)>0
        max_known=torch.where(has_known,max_known,torch.zeros_like(max_known));min_known=torch.where(has_known,min_known,torch.zeros_like(min_known))
        known_mean=(value*known).flatten(1).sum(dim=1)/known.flatten(1).sum(dim=1).clamp_min(1)
        board_mean=expected.flatten(1).sum(dim=1)/exists.flatten(1).sum(dim=1).clamp_min(1)
        extra=[maximum,minimum,max_known,min_known,known_mean,board_mean]
        for card,available in [(features[:,510],features[:,511]),(features[:,484],features[:,485])]:
            matches=((value-card[:,None,None]).abs()<1e-4).float()*known
            count=matches.sum(dim=2)
            removal=torch.where(count>=2,expected.sum(dim=2)/3,-torch.ones_like(count)*2).max(dim=1).values
            removal=torch.where((count>=2).any(dim=1),removal,torch.zeros_like(removal))
            extra.extend([(maximum-card)*available,count.max(dim=1).values/3*available,
                          (count==1).float().mean(dim=1)*available,(count==2).float().mean(dim=1)*available,removal*available])
        improvement=maximum[:,None]-self.card_values[None,:]
        probabilities=features[:,514:529]
        extra.append((improvement.clamp_min(0)*probabilities).sum(dim=1))
        equal=((value.unsqueeze(3)-value.unsqueeze(2)).abs()<1e-4).float()*known.unsqueeze(3)*known.unsqueeze(2)
        pair=(equal.sum(dim=3)==2).float()*known
        extra.extend([(pair*value.clamp_min(0)).flatten(1).sum(dim=1)/8,
                      (pair*(-value).clamp_min(0)).flatten(1).sum(dim=1)/8,
                      ((improvement>0).float()*probabilities).sum(dim=1)])
        return torch.cat([features[:,:GLOBAL_SIZE],torch.stack(extra,dim=1)],dim=1)


class EnrichedSkyloPolicy(SeparatedSkyloPolicy):
    def _build_mlp_extractor(self):
        self.mlp_extractor=EnrichedCandidateExtractor()


class ExportPolicy(nn.Module):
    def __init__(self, policy):
        super().__init__()
        self.extractor = policy.mlp_extractor

    def forward(self, observation):
        return self.extractor.forward_actor(observation)
